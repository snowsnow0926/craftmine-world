export type CreationWishKind = "tree" | "rock" | "chest" | "door" | "marker";
export type CreationWishIntent =
  | {action:"place";kind:CreationWishKind;color?:string;scale?:number[]}
  | {action:"modify";referenceKind?:CreationWishKind;color?:string;scaleFactor?:number};

/** A finite player vocabulary, not a best-effort interpretation of arbitrary prose. */
export const CREATION_WISH_COLORS:Readonly<Record<string,string>>=Object.freeze({
  红:"#ff0000",橙:"#ffa500",黄:"#ffff00",绿:"#008000",蓝:"#0000ff",
  紫:"#800080",黑:"#000000",白:"#ffffff",灰:"#808080",
});
const colorSource="(?:#[a-fA-F0-9]{6}|[红橙黄绿蓝紫黑白灰]色?)";
const numberSource="(?:0?\\.25|0?\\.5|0?\\.75|[1-4](?:\\.0)?|1\\.5|2\\.5|3\\.5|一|二|两|三|四|半)";
const numbers:Record<string,number>={一:1,二:2,两:2,三:3,四:4,半:.5};
const multiplier=(text:string)=>numbers[text]??Number(text);
const color=(text:string)=>text.startsWith("#")?text.toLowerCase():CREATION_WISH_COLORS[text.replace(/色$/,"")];
const references:Record<string,CreationWishKind|undefined>={这棵树:"tree",这块石头:"rock",这个箱子:"chest",这扇门:"door",这个标记:"marker",这个对象:undefined,它:undefined};
const nouns:Array<[string,string,CreationWishKind]>=[["一棵","树","tree"],["一块","石头","rock"],["一个","箱子","chest"],["一扇","门","door"],["一个","标记","marker"]];
type Attributes={color?:string;scaleFactor?:number};
function predicates(text:string):Attributes|null {
  const clauses=text.split(/(?:，?(?:并且|同时|并)|，|和)/);
  if(clauses.length<1||clauses.length>2||clauses.some(value=>!value))return null;
  const result:Attributes={};
  for(const clause of clauses){
    const paint=new RegExp(`^(?:颜色)?(?:改成|改为|变成|设为)(${colorSource})$`).exec(clause)
      ??new RegExp(`^变([红橙黄绿蓝紫黑白灰]色?)$`).exec(clause);
    const size=new RegExp(`^(?:尺寸)?(放大到|缩小到|变为|设为|调整到)(?:原来的)?(${numberSource})倍$`).exec(clause);
    if(paint){if(result.color!==undefined)return null;result.color=color(paint[1]);}
    else if(size){
      const factor=multiplier(size[2]);
      if(result.scaleFactor!==undefined||size[1]==="放大到"&&factor<1||size[1]==="缩小到"&&factor>1)return null;
      result.scaleFactor=factor;
    }
    else if(clause==="变大一倍"){if(result.scaleFactor!==undefined)return null;result.scaleFactor=2;}
    else return null;
  }
  return result;
}
function adjectives(text:string):Attributes|null {
  const result:Attributes={};
  for(let count=0;text&&count<2;count++){
    const paint=new RegExp(`^(${colorSource})(?:的)?`).exec(text);
    const size=new RegExp(`^(${numberSource})倍(?:大小)?(?:的)?`).exec(text);
    if(paint){if(result.color!==undefined)return null;result.color=color(paint[1]);text=text.slice(paint[0].length);}
    else if(size){if(result.scaleFactor!==undefined)return null;result.scaleFactor=multiplier(size[1]);text=text.slice(size[0].length);}
    else return null;
  }
  return text?null:result;
}
export function parseCreationWishIntent(input:string):CreationWishIntent|null {
  if(typeof input!=="string"||input.length>512)return null;
  let text=input.trim().replace(/[。！!]$/,"").replace(/^请/,"");
  // This exact suffix requests preservation already enforced by the host.
  text=text.replace(/，其他东西保持原样$/,"");
  const reference=/^(?:把)?(这棵树|这块石头|这个箱子|这扇门|这个标记|这个对象|它)(?:的)?(.+)$/.exec(text);
  if(reference){const attributes=predicates(reference[2]);return attributes?{action:"modify",referenceKind:references[reference[1]],...attributes}:null;}
  const placement=/^在这里放(?:置)?(.+)$/.exec(text);
  if(!placement)return null;
  const parts=placement[1].split("，");
  if(parts.length>2)return null;
  for(const [quantity,noun,kind] of nouns){
    const entity=parts[0];if(!entity.startsWith(quantity)||!entity.endsWith(noun))continue;
    const attributes=adjectives(entity.slice(quantity.length,-noun.length));if(!attributes)return null;
    if(parts[1]!==undefined){
      const extra=predicates(parts[1]);if(!extra)return null;
      if(extra.color!==undefined&&attributes.color!==undefined||extra.scaleFactor!==undefined&&attributes.scaleFactor!==undefined)return null;
      Object.assign(attributes,extra);
    }
    return {action:"place",kind,...(attributes.color?{color:attributes.color}:{}),...(attributes.scaleFactor!==undefined?{scale:[attributes.scaleFactor,attributes.scaleFactor,attributes.scaleFactor]}:{})};
  }
  return null;
}
