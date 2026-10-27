export interface AgentActivity {
  startedAt:string;lastActivityAt:string;elapsedMs:number;idleMs:number;
  outputEvents:number;workspaceChanges:number;completedCommands:number;repeatedFailures:number;
  attention:boolean;reason?:'inactivity'|'repeated-failure';ended:boolean;observationError?:string;
  lifecycle?:'running'|'finished'|'recovery';
}
