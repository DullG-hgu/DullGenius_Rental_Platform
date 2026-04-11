import React, { useState, useEffect, useRef } from 'react';
import './LazyImage.css';

/**
 * LazyImage Component
 * 
 * @param {string} src - Image source URL
 * @param {string} alt - Alt text
 * @param {string} className - Additional class names
 * @param {object} style - Inline styles
 * @param {function} onClick - Click handler
 * @param {string} aspectRatio - Aspect ratio (e.g., "1/1", "16/9") to prevent CLS
 */
const LazyImage = ({ src, alt, className, style, onClick, aspectRatio = "1/1", fallbackSrc }) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [isInView, setIsInView] = useState(false);
    const [hasError, setHasError] = useState(false);
    const [currentSrc, setCurrentSrc] = useState(null);
    const imgRef = useRef(null);

    useEffect(() => {
        setCurrentSrc(src);
        setHasError(false);
        setIsLoaded(false);
    }, [src]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setIsInView(true);
                    observer.disconnect();
                }
            },
            {
                rootMargin: '800px', // Load images 800px before they appear (more generous)
                threshold: 0.1
            }
        );

        if (imgRef.current) {
            observer.observe(imgRef.current);
        }

        return () => {
            if (imgRef.current) {
                observer.unobserve(imgRef.current);
            }
        };
    }, []);

    const handleLoad = () => {
        setIsLoaded(true);
    };

    const handleError = (e) => {
        if (!hasError) {
            if (fallbackSrc && currentSrc !== fallbackSrc) {
                // Try fallback
                setCurrentSrc(fallbackSrc);
            } else {
                // Both failed or no fallback
                setHasError(true);
                setIsLoaded(true);
            }
        }
    };

    return (
        <div
            className={`lazy-image-wrapper ${className || ''}`}
            ref={imgRef}
            style={{
                ...style,
                aspectRatio: aspectRatio
            }}
            onClick={onClick}
        >
            {!isLoaded && !hasError && (
                <div className="lazy-image-skeleton" />
            )}

            {isInView && (
                <img
                    src={currentSrc || src}
                    alt={alt}
                    className={`lazy-image ${isLoaded ? 'loaded' : ''}`}
                    onLoad={handleLoad}
                    onError={handleError}
                />
            )}

            {hasError && (
                <div className="lazy-image-error">
                    <span>🎲</span>
                </div>
            )}
        </div>
    );
};

export default LazyImage;
