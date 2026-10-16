import { UnitsService } from "./units.service";
describe("unit email history",()=>{
 it("checks unit access before reading campaign recipients",async()=>{
  const db:any={customerUnitSelection:{findUnique:jest.fn().mockResolvedValue({id:'unit',customerId:'owner'})},bulkEmailRecipient:{findMany:jest.fn()}};
  const service:any=new UnitsService(db,{} as any,{} as any);
  jest.spyOn(service,'canAccessUnit').mockReturnValue(false);
  await expect(service.getUnit({id:'other',role:'SALES'},'unit')).rejects.toThrow('No access');
  expect(db.bulkEmailRecipient.findMany).not.toHaveBeenCalled();
 });
 it("limits history to the authorized current owner and exact unit snapshot",async()=>{
  const db:any={customerUnitSelection:{findUnique:jest.fn().mockResolvedValue({id:'unit',customerId:'owner'})},bulkEmailRecipient:{findMany:jest.fn().mockResolvedValue([{id:'mail',subject:'La Joya Perla A-2',status:'SENT'}])}};
  const service:any=new UnitsService(db,{} as any,{} as any);jest.spyOn(service,'canAccessUnit').mockReturnValue(true);
  const result=await service.getUnit({id:'admin',role:'ADMIN'},'unit');
  expect(result.emailHistory[0].subject).toBe('La Joya Perla A-2');
  expect(db.bulkEmailRecipient.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{customerId:'owner',unitSnapshot:{array_contains:[{id:'unit'}]}}}));
 });
});
