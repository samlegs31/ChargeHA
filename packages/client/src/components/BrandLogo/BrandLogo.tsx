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
    <span className={`${styles.logo} ${className}`}>
      <img
        className={styles.icon}
        src="/ev-solar-icon-approved.png"
        alt={alt}
      />
      <span className={styles.wordmark} aria-hidden="true">
        E.V. <span className={styles.solar}>Solar</span>
      </span>
    </span>
  );
}
