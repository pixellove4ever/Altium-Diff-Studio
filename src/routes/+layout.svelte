<script lang="ts">
  import favicon from '$lib/assets/favicon.svg';

  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
  <link
    href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap"
    rel="stylesheet"
  />
  <title>Altium Diff Studio</title>
</svelte:head>

<div class="app-container">
  <header class="app-header">
    <div class="logo-area">
      <svg
        class="logo-icon"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <rect x="2" y="2" width="20" height="20" rx="4" />
        <path d="M9 12h6" />
        <path d="M12 9v6" />
        <circle cx="12" cy="12" r="7" stroke-dasharray="2 2" />
      </svg>
      <div class="logo-text">
        <span class="logo-title">Altium Diff <span class="accent">Studio</span></span>
        <span class="logo-subtitle">Visual Comparator for PCBs, Schematics & BOMs</span>
      </div>
    </div>
    <div class="header-badges">
      <span class="tech-badge">SVELTE 5</span>
      <span class="tech-badge">ELECTRON</span>
    </div>
  </header>

  <main class="main-content">
    {@render children()}
  </main>
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background-color: #0b0b0f;
    color: #e2e8f0;
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow-x: hidden;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .app-container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
    background-image: radial-gradient(
        circle at 10% 20%,
        rgba(99, 102, 241, 0.05) 0%,
        transparent 40%
      ),
      radial-gradient(circle at 90% 80%, rgba(16, 185, 129, 0.04) 0%, transparent 40%);
    background-attachment: fixed;
  }

  .app-header {
    height: 80px;
    padding: 0 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(11, 11, 15, 0.7);
    backdrop-filter: blur(20px);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .logo-area {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .logo-icon {
    width: 36px;
    height: 36px;
    color: #6366f1;
    filter: drop-shadow(0 0 8px rgba(99, 102, 241, 0.5));
    animation: pulse 4s infinite alternate;
  }

  @keyframes pulse {
    0% {
      transform: scale(1);
      filter: drop-shadow(0 0 4px rgba(99, 102, 241, 0.3));
    }
    100% {
      transform: scale(1.04);
      filter: drop-shadow(0 0 12px rgba(99, 102, 241, 0.6));
    }
  }

  .logo-text {
    display: flex;
    flex-direction: column;
  }

  .logo-title {
    font-size: 1.3rem;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.02em;
  }

  .logo-title .accent {
    background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .logo-subtitle {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
    font-weight: 500;
  }

  .header-badges {
    display: flex;
    gap: 8px;
  }

  .tech-badge {
    font-size: 0.65rem;
    font-weight: 700;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.6);
    padding: 4px 10px;
    border-radius: 9999px;
    letter-spacing: 0.05em;
  }

  .main-content {
    flex-grow: 1;
    padding: 40px;
    max-width: 1400px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }

  :global(::-webkit-scrollbar) {
    width: 8px;
    height: 8px;
  }

  :global(::-webkit-scrollbar-track) {
    background: #0b0b0f;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background: rgba(255, 255, 255, 0.2);
  }
</style>
