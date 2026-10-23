import { config } from 'dotenv';
config({ path: 'apps/api/.env' });
config({ path: '.env' });
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
const db=new PrismaClient();
async function main(){
 const email=process.env.ADMIN_EMAIL?.toLowerCase(), password=process.env.ADMIN_PASSWORD;
 if(!email||!password||password.length<12)throw Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters)');
 const role=await db.role.findUniqueOrThrow({where:{code:'SUPER_ADMIN'}});
 const user=await db.user.upsert({where:{email},create:{email,name:'Local Administrator',passwordHash:await bcrypt.hash(password,12)},update:{passwordHash:await bcrypt.hash(password,12),status:'ACTIVE'}});
 await db.userRole.upsert({where:{userId_roleId:{userId:user.id,roleId:role.id}},create:{userId:user.id,roleId:role.id},update:{}});
 console.log('Administrator configured:',email);
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
