import styles from "./BrandLogo.module.css";

interface BrandLogoProps {
  alt?: string;
  className?: string;
}

export function BrandLogo({
  alt = "E.V. Solar",
  className = "",
}: BrandLogoProps) {
  return (
    <picture className={`${styles.logo} ${className}`}>
      <source
        media="(prefers-color-scheme: dark)"
        srcSet="/ev-solar-logo-dark-exact.webp"
      />
      <img
        className={styles.artwork}
        src="/ev-solar-logo-exact.webp"
        alt={alt}
      />
    </picture>
  );
}
