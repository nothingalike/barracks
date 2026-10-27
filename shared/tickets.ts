import type {PmtItem} from './factory.ts';
export interface TicketProgress {
  runId:string;runStatus:string;stage?:string;
  attention?:'blocked'|'waiting'|'inspect';message?:string;
}
export interface TicketBoardItem extends PmtItem {progress?:TicketProgress}
export interface TicketBoardData {items:TicketBoardItem[];statuses:string[]}
