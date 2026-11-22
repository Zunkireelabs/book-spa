// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RoomPickRow from './RoomPickRow';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(cleanup);

const rooms = [
  { id: 'bkk', name: 'BANGKOK', amenities: ['1 Bed'] }, { id: 'cm', name: 'CHAINGMAI', amenities: ['3 Beds'] }, { id: 'fm', name: 'FOOT MASSAGE', amenities: ['2 Chairs'] },
  { id: 'hh', name: 'HUA HIN', amenities: ['1 Bed'] }, { id: 'ped', name: 'PEDICURE', amenities: ['1 Bed'] }, { id: 'ktm', name: 'KATHMANDU', amenities: ['1 Bed'] },
];
const bk = (room_id, s, e) => ({ id: room_id + s, date: '2026-11-22', status: 'Confirmed', room_id, start_time: s, end_time: e });
const bookings = [bk('hh', '11:00:00', '14:00:00'), bk('ped', '12:00:00', '13:30:00'), bk('cm', '12:00:00', '14:00:00'), bk('cm', '12:00:00', '14:00:00')];
const base = { rooms, bookings, date: '2026-11-22', startTime: '12:00', durationMin: 120, value: '' };
const open = () => fireEvent.click(screen.getByRole('button', { name: /./ }));

describe('RoomPickRow', () => {
  it('closed, nothing picked: Any available with how many rooms are free', () => {
    render(<RoomPickRow {...base} onChange={() => {}} />);
    expect(screen.getByText('Any available')).toBeTruthy();
    expect(screen.getByText('4 of 6 rooms free at this time')).toBeTruthy();
  });
  it('list order: Any available, Free at this time (with places left), Full at this time greyed and not pickable', () => {
    const onChange = vi.fn();
    const { container } = render(<RoomPickRow {...base} onChange={onChange} />);
    open();
    const text = container.ownerDocument.body.textContent;
    expect(text.indexOf('Any available')).toBeLessThan(text.indexOf('Free at this time'));
    expect(text.indexOf('Free at this time')).toBeLessThan(text.indexOf('Full at this time'));
    expect(text).toContain('1 of 3 places left');
    expect(text).toContain('Full · free from 2:00 pm');
    expect(container.ownerDocument.querySelectorAll('[data-room-full]').length).toBe(2);
    expect(screen.queryByLabelText('HUA HIN')).toBeNull();
    fireEvent.click(screen.getByLabelText('BANGKOK'));
    expect(onChange).toHaveBeenCalledWith('bkk');
  });
  it('picking Any available returns an empty id', () => {
    const onChange = vi.fn();
    render(<RoomPickRow {...base} value="bkk" onChange={onChange} />);
    open();
    fireEvent.click(screen.getByLabelText('Any available'));
    expect(onChange).toHaveBeenCalledWith('');
  });
  it('no time picked: names and beds only, no status and no section headings', () => {
    const { container } = render(<RoomPickRow {...base} startTime="" onChange={() => {}} />);
    open();
    const text = container.ownerDocument.body.textContent;
    expect(text).toContain('BANGKOK'); expect(text).toContain('1 Bed');
    expect(text).not.toMatch(/Free at this time|Full at this time|places left/);
  });
  it('search box only with more than 8 rooms', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, name: `ROOM ${i}`, amenities: ['1 Bed'] }));
    render(<RoomPickRow {...base} rooms={many} bookings={[]} onChange={() => {}} />);
    open();
    expect(screen.getByLabelText('Search rooms')).toBeTruthy();
    cleanup();
    render(<RoomPickRow {...base} onChange={() => {}} />);
    open();
    expect(screen.queryByLabelText('Search rooms')).toBeNull();
  });
  it('a picked room shows its name with a status line', () => {
    render(<RoomPickRow {...base} value="cm" onChange={() => {}} />);
    expect(screen.getByText('CHAINGMAI')).toBeTruthy();
    expect(screen.getByText(/places left/)).toBeTruthy();
  });
  it('list header carries "<service> · <Day d Mon> · <start>–<end>"; none until a time is picked', () => {
    const { container } = render(<RoomPickRow {...base} serviceName="ENERGISE BODY" onChange={() => {}} />);
    open();
    expect(container.ownerDocument.body.textContent).toContain('ENERGISE BODY · Sun 22 Nov · 12:00 pm–2:00 pm');
    cleanup();
    const again = render(<RoomPickRow {...base} startTime="" serviceName="ENERGISE BODY" onChange={() => {}} />);
    open();
    expect(again.container.ownerDocument.body.textContent).not.toMatch(/Sun 22 Nov/);
  });
});
