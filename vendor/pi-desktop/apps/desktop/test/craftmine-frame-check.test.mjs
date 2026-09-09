import assert from 'node:assert/strict';
import test from 'node:test';
import {checkCraftmineFrame} from '../electron/main/craftmine-frame-check.ts';

test('a nonempty black capture with a HUD is rejected; a rendered world is accepted',()=>{
  const pixels=Buffer.alloc(400*300*4);
  pixels.fill(255,0,400*40*4); // Toolbar text must not make a black game pass.
  const image={getSize:()=>({width:400,height:300}),toBitmap:()=>pixels};
  assert.throws(()=>checkCraftmineFrame(image),/BLANK_GAME_FRAME/);
  for(let y=40;y<300;y++)for(let x=0;x<400;x++){
    const at=(y*400+x)*4;pixels[at]=y<160?150:50;pixels[at+1]=y<160?180:130;pixels[at+2]=y<160?100:60;pixels[at+3]=255;
  }
  assert.equal(checkCraftmineFrame(image).coloredSamples,35);
});
