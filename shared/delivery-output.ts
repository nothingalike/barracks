export interface DeliveryOutput {
  projectIdentityChanged?:boolean;
  workspace:string;projectPath:string;candidate:string;files:string[];
  projectMatches:boolean;acceptancePassed:boolean;
  sourceState:'available'|'changed'|'unavailable';
}
