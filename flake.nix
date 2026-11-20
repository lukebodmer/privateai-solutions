{
  description = "privateai.solutions — Astro static site with Cloudflare Workers deploy";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        name = "privateai-solutions";

        packages = [
          pkgs.nodejs_22
          pkgs.pnpm
          pkgs.wrangler
          pkgs.git
        ];

        shellHook = ''
          echo "privateai.solutions dev shell"
          echo "  pnpm dev          → local dev server + admin dashboard"
          echo "  pnpm build        → production build"
          echo "  pnpm deploy       → build + deploy to Cloudflare Workers"
        '';
      };
    };
}
