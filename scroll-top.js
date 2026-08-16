(() => {
  "use strict";

  const SHOW_AFTER = 320;

  function initScrollTopButton() {
    if (document.getElementById("scrollTopButton")) return;

    const style = document.createElement("style");
    style.textContent = `
      #scrollTopButton {
        position: fixed;
        right: clamp(16px, 2.5vw, 34px);
        bottom: clamp(16px, 2.5vw, 30px);
        z-index: 1200;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 104px;
        min-height: 46px;
        padding: 10px 16px;
        border: 1px solid rgba(255,255,255,.42);
        border-radius: 999px;
        background: rgba(45,41,36,.92);
        color: #fff;
        box-shadow: 0 8px 24px rgba(0,0,0,.22);
        font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
        font-size: 14px;
        font-weight: 800;
        line-height: 1;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px);
        transition: opacity .2s ease, transform .2s ease, visibility .2s ease, background .2s ease;
      }
      #scrollTopButton.is-visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      #scrollTopButton:hover { background: rgba(73,52,39,.98); }
      #scrollTopButton:focus-visible { outline: 3px solid rgba(164,123,72,.42); outline-offset: 3px; }
      #scrollTopButton .scroll-top-arrow { font-size: 18px; transform: translateY(-1px); }
      @media (max-width: 680px) {
        #scrollTopButton {
          right: 14px;
          bottom: 14px;
          min-width: 92px;
          min-height: 42px;
          padding: 9px 13px;
          font-size: 13px;
        }
      }
      @media print { #scrollTopButton { display: none !important; } }
    `;
    document.head.appendChild(style);

    const button = document.createElement("button");
    button.id = "scrollTopButton";
    button.type = "button";
    button.setAttribute("aria-label", "화면 맨 위로 이동");
    button.innerHTML = '<span class="scroll-top-arrow" aria-hidden="true">↑</span><span>처음화면</span>';
    document.body.appendChild(button);

    const modal = document.querySelector(".modal");
    const modalCard = document.querySelector(".modal-card");

    const modalIsOpen = () => modal && !modal.hasAttribute("hidden") && modal.offsetParent !== null;

    const updateVisibility = () => {
      const modalScrolled = modalIsOpen() && modalCard && modalCard.scrollTop > SHOW_AFTER;
      const pageScrolled = window.scrollY > SHOW_AFTER;
      button.classList.toggle("is-visible", Boolean(modalScrolled || pageScrolled));
    };

    button.addEventListener("click", () => {
      if (modalIsOpen() && modalCard) {
        modalCard.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    window.addEventListener("scroll", updateVisibility, { passive: true });
    if (modalCard) modalCard.addEventListener("scroll", updateVisibility, { passive: true });

    if (modal) {
      const observer = new MutationObserver(updateVisibility);
      observer.observe(modal, { attributes: true, attributeFilter: ["hidden", "class", "style", "aria-hidden"] });
    }

    updateVisibility();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScrollTopButton, { once: true });
  } else {
    initScrollTopButton();
  }
})();
