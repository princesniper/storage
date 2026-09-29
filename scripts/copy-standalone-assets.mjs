import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root=process.cwd();
const copy=(src,dst)=>{ if (existsSync(src)) cpSync(src,dst,{recursive:true}); };
copy(resolve(root,'.next/static'),resolve(root,'.next/standalone/.next/static'));
copy(resolve(root,'public'),resolve(root,'.next/standalone/public'));
console.log('Standalone assets copied.');
