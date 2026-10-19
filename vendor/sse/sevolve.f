***
      SUBROUTINE sinit(m,zpars,kw,m0,mt,epoch,r,lum,mc,rc,dtm)
*
*       Set up a zero-age star as NBODY6's INSTAR does (no pre-MS).
*       Written for globsim; not part of SSE or NBODY6.
*       -------------------------------------------------------------
*
      implicit none
      integer kw
      real*8 m,zpars(20),m0,mt,epoch,r,lum,mc,rc,dtm
      real*8 tm,tn,tscls(20),lums(10),GB(10),age,menv,renv,k2
*
      m0 = m
      mt = m
      kw = 1
      mc = 0.d0
      age = 0.d0
      CALL star(kw,m0,mt,tm,tn,tscls,lums,GB,zpars)
      CALL hrdiag(m0,age,mt,tm,tn,tscls,lums,GB,zpars,
     &            r,lum,kw,mc,rc,menv,renv,k2)
      epoch = 0.d0
      CALL sdtm(kw,m0,mt,age,zpars,dtm)
*
      return
      end
***
      SUBROUTINE sdtm(kw,m0,mt,age,zpars,dtm)
*
*       Time to the next stellar-evolution update, in Myr, following
*       NBODY6's TRDOT: a fraction of the current phase, shortened so the
*       radius changes by at most 10 per cent. Works on copies of the state.
*       Written for globsim from TRDOT; not part of SSE or NBODY6.
*       -------------------------------------------------------------
*
      implicit none
      integer kw,it,kwc,kw0
      real*8 m0,mt,age,zpars(20),dtm
      real*8 tm,tn,tscls(20),lums(10),GB(10),menv,renv,k2
      real*8 m0c,m1,agec,age0,rm,rm0,lum,mc,mc1,rcc,dtr,dr,dtdr
      real*8 pts1,pts2,eps,alpha2,tol
      parameter(pts1=0.05d0,pts2=0.02d0)
      parameter(eps=1.0d-06,alpha2=0.09d0,tol=1.0d-10)
*
      kwc = kw
      m0c = m0
      m1 = mt
      agec = age
      mc = 0.d0
      CALL star(kwc,m0c,m1,tm,tn,tscls,lums,GB,zpars)
      CALL hrdiag(m0c,agec,m1,tm,tn,tscls,lums,GB,zpars,
     &            rm,lum,kwc,mc,rcc,menv,renv,k2)
*
*       Quit if there is a change of type at the current time.
      if((kw.le.6.and.kwc.gt.6).or.(kw.le.9.and.kwc.gt.9))then
         dtm = 0.d0
         goto 30
      endif
*
      if(kwc.le.1)then
         dtm = pts1*tm
         dtr = tm - agec
      elseif(kwc.ge.10)then
         dtm = sqrt(10.0/lum)
         dtr = dtm
      elseif(kwc.eq.2)then
         dtm = pts1*(tscls(1) - tm)
         dtr = tscls(1) - agec
      elseif(kwc.eq.3)then
         if(agec.lt.tscls(6))then
            dtm = pts2*(tscls(4) - agec)
         else
            dtm = pts2*(tscls(5) - agec)
         endif
         dtr = MIN(tscls(2),tn) - agec
      elseif(kwc.eq.4)then
         dtm = pts1*tscls(3)
         dtr = MIN(tn,tscls(2) + tscls(3)) - agec
      elseif(kwc.eq.5)then
         if(agec.lt.tscls(9))then
            dtm = pts2*(tscls(7) - agec)
         else
            dtm = pts2*(tscls(8) - agec)
         endif
         dtr = MIN(tn,tscls(13)) - agec
      elseif(kwc.eq.6)then
         if(agec.lt.tscls(12))then
            dtm = pts2*(tscls(10) - agec)
         else
            dtm = pts2*(tscls(11) - agec)
         endif
         dtr = tn - agec
      elseif(kwc.eq.7)then
         dtm = pts1*tm
         dtr = tm - agec
      elseif(kwc.eq.8.or.kwc.eq.9)then
         if(agec.lt.tscls(6))then
            dtm = pts2*(tscls(4) - agec)
         else
            dtm = pts2*(tscls(5) - agec)
         endif
         dtr = tn - agec
      endif
*
      rm0 = rm
      if(kwc.ge.10) goto 30
      age0 = agec
      kw0 = kwc
      mc1 = mc
      it = 0
*
*       Check for type change within the step.
      if((dtr-dtm).le.tol)then
         agec = MAX(agec,agec*(1.d0-eps) + dtr)
         CALL hrdiag(m0c,agec,m1,tm,tn,tscls,lums,GB,zpars,
     &               rm,lum,kwc,mc1,rcc,menv,renv,k2)
         dr = rm - rm0
         if(ABS(dr).gt.0.1*rm0)then
            dtm = dtr - age0*eps
            dtdr = dtm/ABS(dr)
            dtm = alpha2*MAX(rm,rm0)*dtdr
            goto 20
         else
            dtm = dtr
            goto 30
         endif
      endif
*
*       Limit to a 10% increase in radius.
   20 agec = age0 + dtm
      mc1 = mc
      CALL hrdiag(m0c,agec,m1,tm,tn,tscls,lums,GB,zpars,
     &            rm,lum,kwc,mc1,rcc,menv,renv,k2)
      dr = rm - rm0
      it = it + 1
      if(it.eq.20.and.kwc.eq.4) goto 30
      if(it.gt.30) goto 30
      if(ABS(dr).gt.0.1*rm0)then
         dtdr = dtm/ABS(dr)
         dtm = alpha2*MAX(rm0,rm)*dtdr
         if(it.ge.20) dtm = 0.5d0*dtm
         goto 20
      endif
*
   30 continue
      dtm = MAX(dtm,1.0d-04)
*
      return
      end
***
      SUBROUTINE supdate(z,zpars,dtmax,kw,m0,mt,epoch,tev0,
     &                   r,lum,mc,rc,dtm)
*
*       One stellar-evolution update from time tev0, as in NBODY6's MDOT
*       for a single star (no companion, spin or accretion). The step is
*       the TRDOT interval dtm, capped at dtmax, and then shortened so
*       winds remove at most 2 per cent of the mass and no more than the
*       envelope. On return tev0 has advanced and dtm holds the next interval.
*       Written for globsim from MDOT; not part of SSE or NBODY6.
*       -------------------------------------------------------------
*
      implicit none
      integer kw,kws
      real*8 z,zpars(20),dtmax,m0,mt,epoch,tev0,r,lum,mc,rc,dtm
      real*8 tm,tn,tscls(20),lums(10),GB(10),menv,renv,k2
      real*8 age,age0,epch0,m10,m1,mts,rm0,lum0,mc0,tm0,tbgb
      real*8 dt,dmx,dms,dmr,dml,tevk,rm
      real*8 tiny
      parameter(tiny=1.0d-14)
      real*8 mlwind
      external mlwind
*
*       Stellar parameters at the previous epoch.
      kws = kw
      mts = mt
      m10 = m0
      m1 = mt
      age = MAX(tev0 - epoch,0.d0)
      age0 = age
      epch0 = epoch
      mc = 0.d0
      CALL star(kw,m0,m1,tm,tn,tscls,lums,GB,zpars)
      CALL hrdiag(m0,age,m1,tm,tn,tscls,lums,GB,zpars,
     &            rm0,lum0,kw,mc,rc,menv,renv,k2)
      mc0 = mc
      tm0 = tm
      tbgb = tscls(1)
*       Ensure that a change of type happens at the update time.
      if(kw.ne.kws)then
         kw = kws
         m1 = mts
      endif
*
*       Wind mass loss over the interval, limited to 2% and to the envelope.
      dt = 1.0d+06*MIN(dtm,dtmax)
      dmx = mlwind(kw,lum0,rm0,m1,mc0,0.d0,z)
      dms = dmx*dt
      dmr = ABS(dms/(m1 + 1.0d-10))
      if(dmr.gt.0.02)then
         dt = dt*0.02/dmr
         dms = 0.02*m1
      endif
      if(kws.lt.10)then
         dml = MAX(m1 - mc0,1.0d-07)
         if(dml.lt.dms)then
            dt = (dml/dms)*dt
            dms = dml
         endif
      endif
      dmr = ABS(dms/(m1 + 1.0d-10))
*
      if(dmr.gt.tiny)then
         m1 = m1 - dms
*       Rejuvenation of MS, HG or naked helium star.
         if(kw.le.2.or.kw.eq.7)then
            m0 = m1
            CALL star(kw,m0,m1,tm,tn,tscls,lums,GB,zpars)
            if(kw.eq.2)then
               if(GB(9).lt.mc0.or.m10.gt.zpars(3))then
                  m0 = m10
               else
                  epch0 = tm + (tscls(1)-tm)*(age0-tm0)/(tbgb-tm0)
                  epch0 = tev0 - epch0
               endif
            else
               epch0 = tev0 - age0*tm/tm0
            endif
         endif
      endif
*
*       Advance and evaluate the star at the new time.
      tevk = tev0 + dt/1.0d+06
      age = tevk - epch0
      age0 = age
      CALL star(kw,m0,m1,tm,tn,tscls,lums,GB,zpars)
      if((age-tn).gt.1.0d-02)then
         if(kw.le.6)then
            age = MIN(age,0.9999d0*tscls(11))
         else
            age = MIN(age,0.9999d0*tscls(5))
            age = MIN(age,1.0001d0*tn)
         endif
      endif
      CALL hrdiag(m0,age,m1,tm,tn,tscls,lums,GB,zpars,
     &            rm,lum,kw,mc,rc,menv,renv,k2)
*
*       HRDIAG may reset the age (e.g. new mass at He ignition); shift
*       the epoch so that tevk - epoch is the star's new age.
      mt = m1
      r = rm
      epoch = age0 + epch0 - age
      tev0 = tevk
      CALL sdtm(kw,m0,mt,age,zpars,dtm)
*
      return
      end
