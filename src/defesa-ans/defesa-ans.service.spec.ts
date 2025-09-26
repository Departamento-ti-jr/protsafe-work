import { Test, TestingModule } from '@nestjs/testing';
import { DefesaAnsService } from './defesa-ans.service';

describe('DefesaAnsService', () => {
  let service: DefesaAnsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DefesaAnsService],
    }).compile();

    service = module.get<DefesaAnsService>(DefesaAnsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
