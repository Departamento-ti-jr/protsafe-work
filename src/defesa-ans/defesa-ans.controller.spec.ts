import { Test, TestingModule } from '@nestjs/testing';
import { DefesaAnsController } from './defesa-ans.controller';

describe('DefesaAnsController', () => {
  let controller: DefesaAnsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DefesaAnsController],
    }).compile();

    controller = module.get<DefesaAnsController>(DefesaAnsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
