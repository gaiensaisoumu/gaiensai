import { useEffect } from 'preact/hooks';

export const NoIndexMeta = () => {
  useEffect(() => {
    // Add noindex meta tag dynamically
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);

    return () => {
      // Clean up on unmount
      const existingMeta = document.querySelector(
        'meta[name="robots"]',
      ) as HTMLMetaElement | null;
      if (existingMeta && existingMeta.content === 'noindex, nofollow') {
        existingMeta.remove();
      }
    };
  }, []);

  return null;
};
