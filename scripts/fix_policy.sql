
-- Enable RLS on storage.objects (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists to avoid conflicts
DROP POLICY IF EXISTS "Public Access" ON storage.objects;

-- Create a policy that allows anyone (anon + authenticated) to SELECT (read)
-- from the 'game-images' bucket.
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'game-images' );
