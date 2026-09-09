import {parse} from '@babel/parser';

// Parsing only. No child process or authored-code evaluation in Electron.
export function checkModuleSyntax(code) {
  try {parse(code,{sourceType:'module',errorRecovery:false});}
  catch(error){throw Error('玩法源码语法错误：'+String(error.message).slice(0,1600));}
}
