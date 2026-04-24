import { Test, TestingModule } from '@nestjs/testing';
import { TaggerService } from './tagger.service';

describe('TaggerService', () => {
  let service: TaggerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaggerService],
    }).compile();

    service = module.get<TaggerService>(TaggerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('suggestTags', () => {
    it('should suggest Technology for tech-related project', () => {
      const result = service.suggestTags(
        'New Blockchain App',
        'A decentralized platform for smart contracts and digital assets.'
      );
      expect(result).toContain('Technology');
    });

    it('should suggest Environment and Technology for solar energy project', () => {
      const result = service.suggestTags(
        'Solar Grid',
        'Implementing renewable energy solutions using solar panels and smart grid technology.'
      );
      expect(result).toContain('Environment');
      expect(result).toContain('Technology');
    });

    it('should suggest Healthcare for medical project', () => {
      const result = service.suggestTags(
        'MediLink',
        'A hospital management system to improve patient care and medical records.'
      );
      expect(result).toContain('Healthcare');
    });

    it('should suggest Education for learning platform', () => {
      const result = service.suggestTags(
        'EduLearn',
        'An interactive school platform for students to learn coding and science.'
      );
      expect(result).toContain('Education');
      expect(result).toContain('Technology');
    });

    it('should suggest Arts for creative project', () => {
      const result = service.suggestTags(
        'Digital Art Gallery',
        'A place to showcase creative paintings and sculptures in a virtual film.'
      );
      expect(result).toContain('Arts');
    });

    it('should return empty array for text with no matches', () => {
      const result = service.suggestTags('Something', 'Just some random text with no keywords.');
      expect(result).toEqual([]);
    });

    it('should handle plurals correctly', () => {
      const result = service.suggestTags('Schools Project', 'Working with many universities.');
      expect(result).toContain('Education');
    });
  });
});
