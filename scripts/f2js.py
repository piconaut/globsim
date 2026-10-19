#!/usr/bin/env python3
"""Translate the SSE subset of Fortran 77 used by NBODY6 into a JavaScript module.

Covers exactly what zcnsts.f, zfuncs.f, star.f, hrdiag.f, mlwind.f, mrenv.f and
our driver use: REAL*8/INTEGER declarations, PARAMETER, COMMON, DATA, INCLUDE,
block and logical IF, GOTO to top-level labels, CALL, and FUNCTION/SUBROUTINE.
Anything else raises an error rather than being guessed at.

Conventions in the output:
  * arrays are Float64Array with Fortran's 1-based indices (element 0 unused);
  * a SUBROUTINE takes one object holding its arguments, and writes scalar
    outputs back to that object; CALL copies them back into the caller's variables;
  * literals without a D exponent are single precision in Fortran, so they are
    wrapped in Math.fround to reproduce the reference values exactly.

Usage: f2js.py [--skip UNIT ...] OUT.js FILE.f [FILE.f ...]   (INCLUDEd files are read from the same dir)
"""
import os
import re
import sys

INTRINSICS = {
    'sqrt': 'Math.sqrt', 'log10': 'Math.log10', 'log': 'Math.log', 'exp': 'Math.exp',
    'abs': 'Math.abs', 'max': 'Math.max', 'min': 'Math.min', 'tanh': 'Math.tanh',
    'atan': 'Math.atan', 'cos': 'Math.cos', 'sin': 'Math.sin', 'dble': '', 'dsqrt': 'Math.sqrt',
}


class F2JSError(Exception):
    pass


# ---------------------------------------------------------------- source lines

def read_statements(path, base):
    """Yield (label, text, comment) for each logical statement; comments as (None, None, text)."""
    raw = open(path).read().split('\n')
    out = []
    for line in raw:
        if not line.strip():
            continue
        c0 = line[0]
        if c0 in '*cC!':
            out.append((None, None, line[1:].rstrip()))
            continue
        line = line.rstrip()
        if len(line) > 5 and line[5] not in ' 0' and line[:5].strip() == '':
            # continuation
            if not out or out[-1][1] is None:
                raise F2JSError(f'{path}: continuation without statement: {line}')
            lab, text, com = out[-1]
            out[-1] = (lab, text + ' ' + line[6:].strip(), com)
            continue
        label = line[:5].strip() or None
        text = line[6:].strip() if len(line) > 6 else ''
        if '!' in text:
            text = text.split('!')[0].rstrip()
        out.append((label, text, None))
    # Expand INCLUDE.
    res = []
    for lab, text, com in out:
        if text and re.match(r"(?i)include\s+'", text):
            name = re.search(r"'([^']+)'", text).group(1)
            res.extend(read_statements(os.path.join(base, name), base))
        else:
            res.append((lab, text, com))
    return res


# ---------------------------------------------------------------- expressions

TOKEN_RE = re.compile(r"""
    (?P<num>(\d+\.(?!(gt|lt|ge|le|eq|ne|and|or|not)\.)\d*|\.\d+|\d+)([dDeE][+-]?\d+)?)
  | (?P<lop>\.(gt|lt|ge|le|eq|ne|and|or|not)\.)
  | (?P<id>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<op>\*\*|[-+*/(),])
  | (?P<ws>\s+)
""", re.X | re.I)


def tokenize(s):
    pos, toks = 0, []
    while pos < len(s):
        m = TOKEN_RE.match(s, pos)
        if not m:
            raise F2JSError(f'cannot tokenize {s[pos:]!r} in {s!r}')
        pos = m.end()
        kind = m.lastgroup
        if kind == 'ws':
            continue
        val = m.group(kind)
        if kind == 'lop':
            val = val.lower()
        if kind == 'id':
            val = val.lower()
        toks.append((kind, val))
    return toks


class Expr:
    """Recursive-descent parser for Fortran expressions emitting JavaScript."""

    def __init__(self, unit, toks):
        self.u, self.t, self.i = unit, toks, 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def take(self, val=None):
        tok = self.peek()
        if val is not None and tok[1] != val:
            raise F2JSError(f'expected {val!r}, got {tok!r} in {self.t!r}')
        self.i += 1
        return tok

    def parse(self):
        js, ty = self.p_or()
        if self.i != len(self.t):
            raise F2JSError(f'trailing tokens {self.t[self.i:]!r}')
        return js, ty

    def p_or(self):
        a, ta = self.p_and()
        while self.peek()[1] == '.or.':
            self.take()
            b, _ = self.p_and()
            a, ta = f'({a} || {b})', 'bool'
        return a, ta

    def p_and(self):
        a, ta = self.p_not()
        while self.peek()[1] == '.and.':
            self.take()
            b, _ = self.p_not()
            a, ta = f'({a} && {b})', 'bool'
        return a, ta

    def p_not(self):
        if self.peek()[1] == '.not.':
            self.take()
            a, _ = self.p_not()
            return f'(!{a})', 'bool'
        return self.p_rel()

    REL = {'.gt.': '>', '.lt.': '<', '.ge.': '>=', '.le.': '<=', '.eq.': '===', '.ne.': '!=='}

    def p_rel(self):
        a, ta = self.p_add()
        op = self.peek()[1]
        if op in self.REL:
            self.take()
            b, _ = self.p_add()
            return f'({a} {self.REL[op]} {b})', 'bool'
        return a, ta

    def p_add(self):
        # Unary +/- binds like binary +/- in Fortran: -a**2 is -(a**2), -a*b is -(a*b).
        if self.peek()[1] in ('-', '+'):
            op = self.take()[1]
            a, ta = self.p_mul()
            a = f'(-{a})' if op == '-' else a
        else:
            a, ta = self.p_mul()
        while self.peek()[1] in ('+', '-'):
            op = self.take()[1]
            b, tb = self.p_mul()
            a, ta = f'({a} {op} {b})', self.promote(ta, tb)
        return a, ta

    def p_mul(self):
        a, ta = self.p_pow()
        while self.peek()[1] in ('*', '/'):
            op = self.take()[1]
            b, tb = self.p_pow()
            if op == '/' and ta == 'int' and tb == 'int':
                a, ta = f'Math.trunc({a} / {b})', 'int'
            else:
                a, ta = f'({a} {op} {b})', self.promote(ta, tb)
        return a, ta

    def p_pow(self):
        a, ta = self.p_atom()
        if self.peek()[1] == '**':
            self.take()
            # Right-associative; the exponent may carry a unary sign.
            if self.peek()[1] in ('-', '+'):
                op = self.take()[1]
                b, tb = self.p_pow()
                b = f'(-{b})' if op == '-' else b
            else:
                b, tb = self.p_pow()
            return f'Math.pow({a}, {b})', self.promote(ta, tb)
        return a, ta

    @staticmethod
    def promote(a, b):
        return 'int' if a == 'int' and b == 'int' else 'real'

    def p_atom(self):
        kind, val = self.take()
        if kind == 'num':
            return num_literal(val)
        if val == '(':
            e, t = self.p_or()
            self.take(')')
            return f'({e})', t
        if kind == 'id':
            if self.peek()[1] == '(':
                self.take('(')
                args = []
                if self.peek()[1] != ')':
                    while True:
                        args.append(self.p_or())
                        if self.peek()[1] == ',':
                            self.take()
                            continue
                        break
                self.take(')')
                return self.u.call_or_index(val, args)
            return self.u.ref(val)
        raise F2JSError(f'unexpected token {val!r} in {self.t!r}')


def num_literal(val):
    v = val.lower()
    if 'd' in v:
        return repr(float(v.replace('d', 'e'))), 'real'
    if '.' in v or 'e' in v:
        f = float(v)
        return f'Math.fround({f!r})', 'real'
    return str(int(v)), 'int'


# ---------------------------------------------------------------- program units

class Unit:
    def __init__(self, kind, name, args, rtype):
        self.kind, self.name, self.args, self.rtype = kind, name, args, rtype
        self.ints = set()
        self.arrays = {}      # name -> size
        self.params = {}      # name -> js expr
        self.commons = {}     # local name -> global common block
        self.data = {}        # name -> list of js values
        self.globals = set()  # names that come from INCLUDE data
        self.declared = set()
        self.externals = set()
        self.body = []        # list of (label, text) executable statements, plus comments
        self.labels = set()

    # --- name resolution used by Expr
    def ref(self, name):
        if name in self.params:
            return name, ('int' if name in self.ints else 'real')
        if name in self.commons or name in self.arrays or name in self.globals:
            # Whole-array actual argument, e.g. mcgbf(lums(3), GB, lums(6)).
            return self.array_js(name), 'array'
        ty = 'int' if name in self.ints else 'real'
        if self.kind == 'function' and name == self.name:
            return '_ret', ty
        if self.kind == 'subroutine' and name in self.args:
            return f'p.{name}', ty
        return name, ty

    def array_js(self, name):
        if name in self.commons:
            return f'COMMON.{self.commons[name]}'
        if name in self.globals:
            return f'DATA.{name}'
        if self.kind == 'subroutine' and name in self.args:
            return f'p.{name}'
        return name

    def call_or_index(self, name, args):
        if name in self.arrays or name in self.commons or name in self.globals:
            if len(args) != 1:
                raise F2JSError(f'{self.name}: multi-dim array {name}')
            return f'{self.array_js(name)}[{args[0][0]}]', 'real'
        if name in INTRINSICS:
            fn = INTRINSICS[name]
            js = ', '.join(a[0] for a in args)
            ty = 'int' if all(a[1] == 'int' for a in args) and name in ('max', 'min', 'abs') else 'real'
            return (f'{fn}({js})' if fn else f'({js})'), ty
        return f'{name}({", ".join(a[0] for a in args)})', 'real'

    def expr(self, s):
        return Expr(self, tokenize(s)).parse()[0]

    def lvalue(self, s):
        s = s.strip()
        m = re.match(r'(?i)^([a-z_][a-z0-9_]*)\s*(\((.*)\))?$', s)
        if not m:
            raise F2JSError(f'bad lvalue {s!r}')
        name = m.group(1).lower()
        if m.group(2):
            return f'{self.array_js(name)}[{self.expr(m.group(3))}]'
        if name == self.name and self.kind == 'function':
            return '_ret'
        return self.ref(name)[0]


def split_top(s, sep=','):
    parts, depth, cur, quote = [], 0, '', False
    for ch in s:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(cur)
            cur = ''
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def match_paren(s, start):
    depth = 0
    for i in range(start, len(s)):
        if s[i] == '(':
            depth += 1
        elif s[i] == ')':
            depth -= 1
            if depth == 0:
                return i
    raise F2JSError(f'unbalanced parens in {s!r}')


HEADER_RE = re.compile(r'(?i)^(real\*8\s+|integer\s+)?(function|subroutine)\s+([a-z0-9_]+)\s*\((.*)\)\s*$')


def parse_units(stmts, units):
    cur = None
    for lab, text, com in stmts:
        if text is None:
            if cur is not None:
                cur.body.append(('comment', com))
            continue
        low = text.lower()
        m = HEADER_RE.match(text)
        if m and cur is None:
            rtype = (m.group(1) or '').strip().lower()
            args = [a.strip().lower() for a in m.group(4).split(',') if a.strip()]
            cur = Unit(m.group(2).lower(), m.group(3).lower(), args, rtype)
            if rtype.startswith('integer'):
                cur.ints.add(cur.name)
            continue
        if cur is None:
            raise F2JSError(f'statement outside unit: {text}')
        if low == 'end':
            units.append(cur)
            cur = None
            continue
        if low.startswith('implicit'):
            continue
        if low.startswith('external'):
            # Declared functions are calls, not local variables.
            for name in split_top(text[len('external'):]):
                cur.externals.add(name.lower())
            continue
        dm = re.match(r'(?i)^(real\*8|integer)\s+(.*)$', text)
        if dm:
            is_int = dm.group(1).lower() == 'integer'
            for item in split_top(dm.group(2)):
                im = re.match(r'(?i)^([a-z0-9_]+)\s*(\((\d+)\))?$', item)
                if not im:
                    raise F2JSError(f'bad declaration {item!r}')
                name = im.group(1).lower()
                cur.declared.add(name)
                if is_int:
                    cur.ints.add(name)
                if im.group(3):
                    cur.arrays[name] = int(im.group(3))
            continue
        pm = re.match(r'(?i)^parameter\s*\((.*)\)$', text)
        if pm:
            for item in split_top(pm.group(1)):
                k, v = item.split('=', 1)
                cur.params[k.strip().lower()] = cur.expr(v)
            continue
        cm = re.match(r'(?i)^common\s*/(\w+)/\s*(\w+)$', text)
        if cm:
            cur.commons[cm.group(2).lower()] = cm.group(1).upper()
            cur.arrays.pop(cm.group(2).lower(), None)
            continue
        dd = re.match(r'(?i)^data\s+(\w+)\s*/(.*)/$', text)
        if dd:
            vals = []
            for v in split_top(dd.group(2)):
                rep = re.match(r'^(\d+)\*(.*)$', v)
                if rep:
                    vals += [cur.expr(rep.group(2))] * int(rep.group(1))
                else:
                    vals.append(cur.expr(v))
            cur.data[dd.group(1).lower()] = vals
            continue
        if lab:
            cur.labels.add(lab)
        cur.body.append((lab, text))
    if cur is not None:
        raise F2JSError(f'unterminated unit {cur.name}')


# ---------------------------------------------------------------- statements

def emit_unit(u, signatures):
    out = []
    ind = 1
    lines = []

    def w(s):
        lines.append('  ' * ind + s)

    top_labels = []  # labels that appear at nesting depth 0

    # First pass to find which labels sit at the top level.
    depth = 0
    for item in u.body:
        if item[0] == 'comment':
            continue
        lab, text = item
        low = text.lower()
        if lab and depth == 0:
            top_labels.append(lab)
        elif lab:
            raise F2JSError(f'{u.name}: label {lab} is nested; goto into blocks is unsupported')
        if re.match(r'(?i)^if\s*\(.*\)\s*then$', text) and is_block_if(text):
            depth += 1
        elif re.match(r'(?i)^end\s*if$', low):
            depth -= 1
    has_goto = any(item[0] != 'comment' and re.search(r'(?i)\bgo\s*to\b', item[1]) for item in u.body)

    def stmt(text):
        low = text.lower().strip()
        if low == 'continue':
            return
        if low == 'return':
            w('return _ret;' if u.kind == 'function' else 'return;')
            return
        g = re.match(r'(?i)^go\s*to\s+(\d+)$', text)
        if g:
            if g.group(1) not in top_labels:
                raise F2JSError(f'{u.name}: goto {g.group(1)} to a non-top-level label')
            w(f'{{ _L = {g.group(1)}; continue _d; }}')
            return
        c = re.match(r'(?i)^call\s+(\w+)\s*\((.*)\)$', text)
        if c:
            emit_call(c.group(1).lower(), split_top(c.group(2)))
            return
        # Logical IF: if (cond) stmt
        lm = re.match(r'(?i)^if\s*\(', text)
        if lm:
            close = match_paren(text, text.index('('))
            cond = text[text.index('(') + 1:close]
            rest = text[close + 1:].strip()
            w(f'if ({u.expr(cond)}) {{')
            nonlocal ind
            ind += 1
            stmt(rest)
            ind -= 1
            w('}')
            return
        a = split_assign(text)
        if a:
            lhs, rhs = a
            w(f'{u.lvalue(lhs)} = {u.expr(rhs)};')
            return
        raise F2JSError(f'{u.name}: unsupported statement {text!r}')

    def emit_call(name, actuals):
        if name not in signatures:
            raise F2JSError(f'{u.name}: CALL to unknown subroutine {name}')
        dummies, arrays = signatures[name]
        if len(dummies) != len(actuals):
            raise F2JSError(f'{u.name}: CALL {name} has {len(actuals)} args, expects {len(dummies)}')
        parts, back = [], []
        for d, a in zip(dummies, actuals):
            if d in arrays:
                parts.append(f'{d}: {u.array_js(a.lower())}')
            else:
                parts.append(f'{d}: {u.expr(a)}')
                if re.match(r'(?i)^[a-z_][a-z0-9_]*$', a) and a.lower() not in u.params:
                    back.append(f'{u.lvalue(a)} = _c.{d};')
        w(f'{{ const _c = {{ {", ".join(parts)} }}; {name}(_c); {" ".join(back)} }}')

    # Header.
    if u.kind == 'function':
        out.append(f'function {u.name}({", ".join(u.args)}) {{')
    else:
        out.append(f'function {u.name}(p) {{')
    # Locals.
    for k, v in u.params.items():
        lines.append(f'  const {k} = {v};')
    for k, vals in u.data.items():
        size = u.arrays.get(k, len(vals))
        lines.append(f'  const {k} = new Float64Array([0, {", ".join(vals)}]);')
        if len(vals) != size:
            raise F2JSError(f'{u.name}: DATA {k} has {len(vals)} values for size {size}')
    locals_ = sorted(n for n in u.declared
                     if n not in u.args and n not in u.params and n not in u.commons
                     and n not in u.data and n != u.name and n not in u.globals
                     and n not in u.externals)
    scalars = [n for n in locals_ if n not in u.arrays]
    for n in locals_:
        if n in u.arrays:
            lines.append(f'  const {n} = new Float64Array({u.arrays[n] + 1});')
    if scalars:
        lines.append(f'  let {" = 0, ".join(scalars)} = 0;')
    if u.kind == 'function':
        lines.append('  let _ret = 0;')
    if has_goto:
        lines.append('  let _L = 0;')
        lines.append('  _d: for (;;) {')
        lines.append('    switch (_L) {')
        lines.append('      case 0:')
        ind = 4

    for item in u.body:
        if item[0] == 'comment':
            com = item[1].strip()
            if com and set(com) - set('-*'):
                w(f'// {com}')
            continue
        lab, text = item
        low = text.lower()
        if lab and has_goto and lab in top_labels:
            # Close nothing: labels are only at depth 0, so a case is legal here.
            lines.append('  ' * (ind - 1) + f'case {lab}:')
        if re.match(r'(?i)^if\s*\(.*\)\s*then$', text) and is_block_if(text):
            close = match_paren(text, text.index('('))
            w(f'if ({u.expr(text[text.index("(") + 1:close])}) {{')
            ind += 1
            continue
        em = re.match(r'(?i)^else\s*if\s*\((.*)\)\s*then$', text)
        if em:
            inner = text[text.lower().index('if') + 2:].strip()
            close = match_paren(inner, 0)
            ind -= 1
            w(f'}} else if ({u.expr(inner[1:close])}) {{')
            ind += 1
            continue
        if low == 'else':
            ind -= 1
            w('} else {')
            ind += 1
            continue
        if re.match(r'(?i)^end\s*if$', low):
            ind -= 1
            w('}')
            continue
        stmt(text)

    if has_goto:
        lines.append('    }')
        lines.append('    break;')
        lines.append('  }')
    lines.append('  return _ret;' if u.kind == 'function' else '  return;')
    # Copy-out of subroutine dummies happens through `p` directly.
    out.extend(lines)
    out.append('}')
    return '\n'.join(out)


def is_block_if(text):
    close = match_paren(text, text.index('('))
    return text[close + 1:].strip().lower() == 'then'


def split_assign(text):
    depth = 0
    for i, ch in enumerate(text):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        elif ch == '=' and depth == 0:
            if text[i + 1:i + 2] == '=' or text[i - 1:i] in '<>!':
                return None
            return text[:i], text[i + 1:]
    return None


def main():
    args = sys.argv[1:]
    skip = set()
    while args and args[0] == '--skip':
        skip.add(args[1].lower())
        args = args[2:]
    out_path, files = args[0], args[1:]
    units = []
    for f in files:
        parse_units(read_statements(f, os.path.dirname(f)), units)
    units = [u for u in units if u.name not in skip]
    # Names supplied by INCLUDEd DATA statements become shared globals.
    data = {}
    for u in units:
        if u.data and u.name == 'zcnsts':
            for k in list(u.data):
                if k in ('xz', 'xt', 'xl', 'xr', 'xg', 'xh'):
                    data[k] = u.data.pop(k)
                    u.globals.add(k)
                    u.declared.discard(k)
    signatures = {u.name: (u.args, set(u.arrays) | set(u.commons)) for u in units if u.kind == 'subroutine'}
    # A typed name that is not an array but is another unit's FUNCTION is a call.
    functions = {u.name for u in units if u.kind == 'function'}
    for u in units:
        u.externals |= {n for n in u.declared if n in functions and n not in u.arrays and n != u.name}
    js = ['// Generated by scripts/f2js.py from the Fortran in vendor/sse. Do not edit.',
          '/* eslint-disable */', '',
          'const COMMON = { MSCFF: new Float64Array(201), GBCFF: new Float64Array(201) };',
          'const DATA = {']
    for k, vals in data.items():
        js.append(f'  {k}: new Float64Array([0, {", ".join(vals)}]),')
    js.append('};')
    js.append('')
    for u in units:
        js.append(emit_unit(u, signatures))
        js.append('')
    names = ', '.join(u.name for u in units)
    js.append(f'export {{ {names} }};')
    open(out_path, 'w').write('\n'.join(js) + '\n')
    print(f'wrote {out_path}: {len(units)} units')


if __name__ == '__main__':
    try:
        main()
    except F2JSError as e:
        sys.exit(f'f2js: {e}')
