import { FileCategory } from '../../shared/types';
import { getCategoryForExtension, CATEGORIES } from '../../shared/categories';

export class CategoryMapper {
  private customRules: Map<string, FileCategory> = new Map();

  setCustomRule(extension: string, category: FileCategory): void {
    this.customRules.set(extension.toLowerCase(), category);
  }

  removeCustomRule(extension: string): void {
    this.customRules.delete(extension.toLowerCase());
  }

  getCategory(filename: string): FileCategory {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return 'other';

    const customCategory = this.customRules.get(ext);
    if (customCategory) {
      return customCategory;
    }

    return getCategoryForExtension(filename);
  }

  getAllCategories(): typeof CATEGORIES {
    return CATEGORIES;
  }

  loadCustomRules(rules: Record<string, FileCategory>): void {
    this.customRules.clear();
    for (const [ext, category] of Object.entries(rules)) {
      this.customRules.set(ext.toLowerCase(), category);
    }
  }

  exportCustomRules(): Record<string, FileCategory> {
    const rules: Record<string, FileCategory> = {};
    for (const [ext, category] of this.customRules) {
      rules[ext] = category;
    }
    return rules;
  }
}

export const categoryMapper = new CategoryMapper();
