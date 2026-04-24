import { Injectable, Logger } from '@nestjs/common';
import nlp from 'compromise';

@Injectable()
export class TaggerService {
  private readonly logger = new Logger(TaggerService.name);

  // Mapping of categories to their associated keywords
  private readonly categoryKeywords: Record<string, string[]> = {
    Technology: [
      'tech', 'technology', 'software', 'app', 'web', 'ai', 'artificial', 'intelligence',
      'blockchain', 'crypto', 'robot', 'device', 'hardware', 'digital',
      'internet', 'platform', 'automation', 'computing', 'network'
    ],
    Environment: [
      'green', 'nature', 'planet', 'climate', 'solar', 'wind', 'ocean',
      'water', 'conservation', 'eco', 'recycling', 'sustainable',
      'sustainability', 'forest', 'wildlife', 'energy', 'renewable'
    ],
    Education: [
      'school', 'schools', 'learning', 'teaching', 'student', 'students', 'university', 'universities', 'course',
      'courses', 'training', 'knowledge', 'literacy', 'library', 'academy', 'education'
    ],
    Healthcare: [
      'medical', 'health', 'doctor', 'doctors', 'hospital', 'hospitals', 'patient', 'patients', 'medicine',
      'drug', 'drugs', 'vaccine', 'vaccines', 'wellness', 'mental', 'fitness', 'disability',
      'disease', 'diseases', 'clinic', 'clinics'
    ],
    Arts: [
      'art', 'music', 'film', 'movie', 'theater', 'dance', 'painting',
      'sculpture', 'design', 'creative', 'culture', 'exhibition', 'gallery'
    ],
    Community: [
      'local', 'social', 'support', 'volunteer', 'charity', 'neighborhood',
      'youth', 'senior', 'family', 'inclusion', 'diversity', 'society'
    ],
    Infrastructure: [
      'building', 'road', 'bridge', 'transport', 'urban', 'city', 'rural',
      'housing', 'utility', 'power', 'facility', 'construction'
    ],
    Research: [
      'science', 'laboratory', 'experiment', 'data', 'analysis',
      'investigation', 'study', 'finding', 'theory', 'academic', 'research'
    ],
    Finance: [
      'bank', 'money', 'investment', 'credit', 'loan', 'payment', 'economy',
      'market', 'startup', 'business', 'entrepreneur', 'finance'
    ],
  };

  /**
   * Suggest tags for a project based on its title and description
   * @param title Project title
   * @param description Project description
   * @returns Array of suggested categories
   */
  suggestTags(title: string, description: string): string[] {
    const combinedText = `${title} ${description}`;
    const doc = nlp(combinedText);
    doc.compute('root');

    const matchedCategories = new Set<string>();

    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      for (const keyword of keywords) {
        if (doc.match(keyword).found) {
          matchedCategories.add(category);
          break;
        }
      }
    }

    const suggestions = Array.from(matchedCategories);
    this.logger.debug(`Suggested tags for "${title}": ${suggestions.join(', ')}`);
    
    return suggestions;
  }
}
