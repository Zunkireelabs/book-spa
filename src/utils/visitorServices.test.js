import { describe, it, expect } from 'vitest';
import { homeServiceNameSet, servicesBookableHere } from './visitorServices';

describe('visitor services', () => {
  const home = [{ id: 'a', name: 'Swedish ' }, { id: 'b', name: 'Hot Stone' }, { id: 'c', name: 'Facial' }];
  const elig = { b: ['other'], c: ['t1'] }; // Hot Stone is restricted to someone else; Facial to t1; Swedish is open
  it('keeps home services the visitor does (open or linked), by trimmed lower-case name', () => {
    expect([...homeServiceNameSet(home, elig, 't1')].sort()).toEqual(['facial', 'swedish']);
  });
  it('limits the visited branch to names the visitor also does at home', () => {
    const names = homeServiceNameSet(home, elig, 't1');
    const here = [{ id: 'x', name: 'swedish' }, { id: 'y', name: 'Hot stone' }, { id: 'z', name: 'Thai' }];
    expect(servicesBookableHere(here, names).map((s) => s.id)).toEqual(['x']);
  });
});
