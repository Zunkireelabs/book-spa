import { nepalDateOf } from './nepalTime';

// YYYY-MM-DD of a Date in Nepal (for <input type="date"> values).
export function toDateInputValue(date) {
  return nepalDateOf(date);
}
