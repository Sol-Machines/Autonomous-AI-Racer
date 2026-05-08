import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Courier New"', "Courier", "monospace"],
      },
      keyframes: {
        "boost-pulse": {
          "0%, 100%": { opacity: "0.75" },
          "50%": { opacity: "1" },
        },
        "card-connect": {
          "0%": { borderColor: "#ff8800", boxShadow: "0 0 4px rgba(255,136,0,0.2)" },
          "100%": { borderColor: "#ffcc00", boxShadow: "0 0 14px rgba(255,200,0,0.5)" },
        },
      },
      animation: {
        "boost-pulse": "boost-pulse 0.5s ease-in-out infinite",
        "card-connect": "card-connect 0.75s ease-in-out infinite alternate",
      },
    },
  },
  plugins: [],
};

export default config;
