/** Preserve a start generation after a turn ends, so asynchronous reads can
 * reject a newer request even when it starts and finishes before they return. */
export class ActiveTurns extends Map<string,string> {
  private generations=new Map<string,number>();
  constructor(){super();}
  override set(sessionId:string,turnId:string){
    this.generations.set(sessionId,(this.generations.get(sessionId)??0)+1);
    return super.set(sessionId,turnId);
  }
  generation(sessionId:string){return this.generations.get(sessionId)??0;}
}
