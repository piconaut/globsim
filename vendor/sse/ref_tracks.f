***
      PROGRAM reftracks
*
*       Reference tracks for testing the JavaScript port: evolve a grid of
*       stars to 12 Gyr and print every update. Written for globsim.
*
      implicit none
      integer kw,i,j,nstep
      real*8 zpars(20),y(2),z,ms(17)
      real*8 m0,mt,epoch,tev0,r,lum,mc,rc,dtm
      data ms /0.1d0,0.3d0,0.5d0,0.7d0,0.8d0,0.85d0,0.9d0,1.d0,1.5d0,
     &         2.d0,3.d0,5.d0,8.d0,12.d0,20.d0,30.d0,50.d0/
      y(1) = 0.2402d0
      y(2) = 0.32d0
      z = 1.0d-04
      do 20 j = 1,2
         CALL zcnsts(y(j),z,zpars)
         write(*,'(a,i2,20es25.16)') 'ZPARS ',j,(zpars(i),i=1,20)
         do 10 i = 1,17
            CALL sinit(ms(i),zpars,kw,m0,mt,epoch,r,lum,mc,rc,dtm)
            tev0 = 0.d0
            nstep = 0
    5       continue
            write(*,'(a,2i3,i6,7es25.16)') 'T ',j,i,nstep,tev0,
     &           dble(kw),m0,mt,r,lum,mc
            if(tev0.ge.12000.d0.or.nstep.ge.5000) goto 10
            CALL supdate(z,zpars,1.0d+30,kw,m0,mt,epoch,tev0,
     &                   r,lum,mc,rc,dtm)
            nstep = nstep + 1
            goto 5
   10    continue
   20 continue
      end
