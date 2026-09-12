type Metric={status:'unknown'|'measured';monitor:string|null;unit:string;rawValue?:number;rawUnit?:string;value?:number};
export function validateEnginePerformance(sample:unknown,options:{actualVersion:string;previousSequence?:number|null}):{
  format:'craftmine.validated-engine-performance/1';engineVersion:string;profile:string;sequence:number;
  sampledAt:string;monotonicUsec:number;processFrame:number;physicsFrame:number;framesDrawn:number;
  paused:boolean;headless:boolean;debugBuild:boolean;editorHint:boolean;renderingMethod:string;renderingDriver:string;
  metrics:Record<string,Metric>;authority:'not-attested-by-structural-validation';limitations:string[];
};
