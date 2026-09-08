import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
    window.scrollTo = vi.fn();
    afterEach(() => {
        cleanup();
        localStorage.clear();
        sessionStorage.clear();
    });
}
