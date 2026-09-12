import test from 'node:test';
import assert from 'node:assert/strict';
import { GameplaySession } from '../app/gameplay.mjs';
import { CombatEncounter } from '../app/combat-encounter.mjs';

const systems=[
 {id:'health',name:'生命',type:'health',config:{maxHealth:100,fallDamage:0,regenPerSecond:0},source:null},
 {id:'blade',name:'剑',type:'melee',config:{damage:25,range:4,cooldown:.2},source:null},
];
const run=save=>new CombatEncounter(new GameplaySession(systems,[{id:'monster-one',components:{health:60}}],save?.gameplay),{id:'monster-one',maxHealth:60,attackDamage:12,attackCooldown:.5,loot:['coin','fang']},save?.encounter);

test('连续攻击、受击、死亡与掉落沿用实体和武器路径',()=>{const e=run();assert.equal(e.attack(2).damage,25);e.tick(.2);assert.equal(e.monsterAttack().damage,12);e.tick(.5);e.attack(2);e.tick(.2);const last=e.attack(2);assert.equal(last.defeated,true);assert.deepEqual(e.collectLoot(),['coin','fang']);assert.deepEqual(e.collectLoot(),[]);});
test('怪物状态、掉落领取和复活跨快照恢复',()=>{const e=run();for(let i=0;i<3;i++){e.attack(2);e.tick(.2);}const save={gameplay:e.gameplay.snapshot(),encounter:e.snapshot()};const resumed=run(save);assert.equal(resumed.snapshot().monster.defeated,true);assert.deepEqual(resumed.collectLoot(),['coin','fang']);assert.equal(resumed.respawn(),true);assert.equal(resumed.snapshot().monster.respawns,1);assert.equal(resumed.snapshot().monster.health,60);});
test('未击败不能拾取，冷却不会制造额外伤害',()=>{const e=run();assert.deepEqual(e.collectLoot(),[]);assert.equal(e.monsterAttack().damage,12);assert.equal(e.monsterAttack().hit,false);});
