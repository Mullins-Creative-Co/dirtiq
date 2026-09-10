import {NextRequest,NextResponse} from 'next/server';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {revalidatePath} from 'next/cache';
export const runtime='nodejs';
const run=promisify(execFile);
export async function GET(req:NextRequest){
 const secret=process.env.DIRTIQ_CRON_SECRET;
 if(!secret) return NextResponse.json({ok:false,error:'Scheduled HTTP refresh is not configured. Run the persistent worker or configure DIRTIQ_CRON_SECRET.'},{status:503});
 if(req.headers.get('authorization')!==`Bearer ${secret}`) return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const {stdout}=await run(process.env.DIRTIQ_PYTHON??'python3',['scripts/auto_refresh.py'],{cwd:process.cwd(),timeout:300000,maxBuffer:2*1024*1024});
  const line=stdout.trim().split('\n').at(-1);
  if(!line) return NextResponse.json({ok:true,message:'Another refresh is already running.'});
  const report=JSON.parse(line);
  revalidatePath('/');revalidatePath('/preview/world-100');revalidatePath('/bet');
  return NextResponse.json(report,{status:report.ok?200:500});
 }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Refresh failed'},{status:500});}
}
