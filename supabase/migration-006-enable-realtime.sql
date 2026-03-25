-- ============================================================
-- Migration 006: Enable Realtime for bookings table
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable realtime for the bookings table
-- This allows the dashboard to receive live updates when bookings are created/updated
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;

-- Verify it's enabled by running:
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
