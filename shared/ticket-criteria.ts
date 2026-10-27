export interface TicketCriterion {id:string;description:string}
export function ticketCriteria(ticket:{id:string;body:string}):TicketCriterion[]{
  const section=/^##\s+Acceptance Criteria\s*\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(ticket.body)?.[1]??'';
  return section.split(/\r?\n/).filter(line=>/^\s*[-*]\s+/.test(line)).map((line,index)=>({id:ticket.id+':'+(index+1),description:line.replace(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?/,'')}));
}
