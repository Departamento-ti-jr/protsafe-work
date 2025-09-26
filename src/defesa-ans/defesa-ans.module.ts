import { Module } from '@nestjs/common';
import { DefesaAnsController } from './defesa-ans.controller';
import { DefesaAnsService } from './defesa-ans.service';

@Module({
  controllers: [DefesaAnsController],
  providers: [DefesaAnsService]
})
export class DefesaAnsModule {}
