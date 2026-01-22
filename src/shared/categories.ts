import { CategoryInfo, FileCategory } from './types';

export const CATEGORIES: Record<FileCategory, CategoryInfo> = {
  documents: {
    id: 'documents',
    name: 'Documents',
    color: '#4A90D9',
    extensions: [
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'txt', 'rtf', 'odt', 'ods', 'odp', 'pages', 'numbers', 'keynote',
      'md', 'markdown', 'csv', 'json', 'xml', 'yaml', 'yml'
    ]
  },
  applications: {
    id: 'applications',
    name: 'Applications',
    color: '#9B59B6',
    extensions: [
      'app', 'dmg', 'pkg', 'exe', 'msi', 'deb', 'rpm'
    ]
  },
  'media-audio': {
    id: 'media-audio',
    name: 'Audio',
    color: '#E74C3C',
    extensions: [
      'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'aiff', 'alac'
    ]
  },
  'media-video': {
    id: 'media-video',
    name: 'Video',
    color: '#E67E22',
    extensions: [
      'mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg'
    ]
  },
  'media-images': {
    id: 'media-images',
    name: 'Images',
    color: '#F1C40F',
    extensions: [
      'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'tiff', 'tif',
      'ico', 'heic', 'heif', 'raw', 'psd', 'ai', 'eps'
    ]
  },
  developer: {
    id: 'developer',
    name: 'Developer',
    color: '#1ABC9C',
    extensions: [
      'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp',
      'cs', 'go', 'rs', 'swift', 'kt', 'scala', 'php', 'pl', 'sh', 'bash',
      'zsh', 'sql', 'html', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
      'gitignore', 'dockerignore', 'env', 'lock'
    ]
  },
  archives: {
    id: 'archives',
    name: 'Archives',
    color: '#95A5A6',
    extensions: [
      'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz', 'tbz2'
    ]
  },
  system: {
    id: 'system',
    name: 'System',
    color: '#7F8C8D',
    extensions: [
      'dll', 'so', 'dylib', 'sys', 'kext', 'plist', 'log', 'cache'
    ]
  },
  other: {
    id: 'other',
    name: 'Other',
    color: '#BDC3C7',
    extensions: []
  }
};

const extensionMap = new Map<string, FileCategory>();

for (const [category, info] of Object.entries(CATEGORIES)) {
  for (const ext of info.extensions) {
    extensionMap.set(ext.toLowerCase(), category as FileCategory);
  }
}

export function getCategoryForExtension(filename: string): FileCategory {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return 'other';
  return extensionMap.get(ext) || 'other';
}

export function getCategoryColor(category: FileCategory): string {
  return CATEGORIES[category]?.color || CATEGORIES.other.color;
}

export function getCategoryName(category: FileCategory): string {
  return CATEGORIES[category]?.name || 'Other';
}

export function aggregateCategories(categories: FileCategory[]): Map<FileCategory, number> {
  const counts = new Map<FileCategory, number>();
  for (const cat of categories) {
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  return counts;
}
