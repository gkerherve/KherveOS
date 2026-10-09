import { ORBIT } from '../../src/apps/kmotion/scenes/orbit.ts'
import { cleanParams } from '../../src/apps/kmotion/registry.ts'
for (const side of ['behind','ahead']) {
  const a: any = ORBIT.create(cleanParams('orbit', { ...ORBIT.defaults('slingshot'), side, b: 0.006 }), 'rk4')
  console.log(side, a.vSunIn, a.vSunOutTheory, a.params.side)
}
