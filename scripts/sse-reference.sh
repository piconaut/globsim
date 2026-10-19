#!/bin/sh
# Rebuild tests/fixtures/sse-reference.txt from the original Fortran (needs gfortran).
# Keeps the ZPARS lines, every 20th update of each track, and each track's last update.
set -e
cd "$(dirname "$0")/../vendor/sse"
tmp=$(mktemp -d)
gfortran -O0 -std=legacy -w -o "$tmp/reftracks" ref_tracks.f sevolve.f zcnsts.f zfuncs.f star.f hrdiag.f mlwind.f mrenv.f
"$tmp/reftracks" > "$tmp/ref.txt"
awk '$1=="ZPARS"{print; next}
     $1=="T"{k=$2" "$3; if ($4 % 20 == 0) print; last[k]=$0; order[++n]=k}
     END{for (i=1;i<=n;i++) if (!(order[i] in done)) {done[order[i]]=1; print "LAST " substr(last[order[i]],3)}}' \
  "$tmp/ref.txt" > ../../tests/fixtures/sse-reference.txt
rm -r "$tmp"
wc -l ../../tests/fixtures/sse-reference.txt
