import { describe, expect, it } from 'vitest';
import { nameLines } from './nodeLabel';

describe('node labels', () => {
  it('wraps long names onto two lines', () => {
    expect(nameLines('Ann Lee')).toEqual(['Ann Lee']);
    expect(nameLines('Arthur Longname-Hyphenated')).toEqual(['Arthur', 'Longname-Hyphena…']);
    expect(nameLines('Maria Anna Sophia Theresa von Beispiel')).toEqual(['Maria Anna Sophia', 'Theresa von Beis…']);
    expect(nameLines('Supercalifragilisticexpialidocious')).toEqual(['Supercalifragili…']);
  });
});
