import { unitEmailSubject } from "./unit-email-subject";
describe("unit email subject",()=>{
  it("uses the CRM project and unit, without changing the approved body",()=>expect(unitEmailSubject("LA_JOYA_PERLA",["A2"])).toBe("La Joya Perla A-2"));
  it("lists every owned unit naturally and removes duplicates",()=>expect(unitEmailSubject("LA_JOYA_PERLA",["A10","A-2","A2"])).toBe("La Joya Perla A-2, A-10"));
});
