{
  description = "Reproducible test environment for this repository";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;

      perSystem = system:
        let
          pkgs = import nixpkgs { inherit system; };
          testTools = with pkgs; [
            bash
            coreutils
            diffutils
            findutils
            gnugrep
            gnused
            nodejs_24
            util-linux
          ];
          runAllTests = pkgs.writeShellApplication {
            name = "run-all-tests";
            runtimeInputs = testTools;
            text = ''
              failed=0

              run_suite() {
                name="$1"
                shift
                printf '\n==> %s\n' "$name"
                if "$@"; then
                  printf 'PASS %s\n' "$name"
                else
                  status=$?
                  printf 'FAIL %s (exit %s)\n' "$name" "$status" >&2
                  failed=1
                fi
              }

              run_suite "check-knowledge-diff.test.mjs" node --test scripts/test/check-knowledge-diff.test.mjs
              run_suite "check-knowledge-quality.test.mjs" node --test scripts/test/check-knowledge-quality.test.mjs
              run_suite "fetch-ai-prompts.test.mjs" node --test scripts/test/fetch-ai-prompts.test.mjs
              run_suite "filter-related-knowledge.test.mjs" node --test scripts/test/filter-related-knowledge.test.mjs
              run_suite "test-conventions.test.mjs" node --test scripts/test/test-conventions.test.mjs
              run_suite "register-ai-prompt.test.sh" bash scripts/test/register-ai-prompt.test.sh
              run_suite "save-ai-prompt.test.sh" bash scripts/test/save-ai-prompt.test.sh

              exit "$failed"
            '';
          };
          testCheck = pkgs.runCommand "repository-tests" {
            nativeBuildInputs = [ runAllTests pkgs.coreutils pkgs.gnused ];
          } ''
            cp -R ${self} "$TMPDIR/source"
            chmod -R u+w "$TMPDIR/source"
            patchShebangs "$TMPDIR/source"
            cd "$TMPDIR/source"
            run-all-tests

            cp ${runAllTests}/bin/run-all-tests "$TMPDIR/run-all-tests-failure-case"
            sed -i 's|node --test scripts/test/check-knowledge-diff.test.mjs|false|' "$TMPDIR/run-all-tests-failure-case"
            set +e
            cd "$TMPDIR/source"
            "$TMPDIR/run-all-tests-failure-case" > "$TMPDIR/failure-case.log" 2>&1
            status=$?
            set -e
            test "$status" -ne 0
            grep -q 'FAIL check-knowledge-diff.test.mjs' "$TMPDIR/failure-case.log"
            for suite in \
              check-knowledge-quality.test.mjs \
              fetch-ai-prompts.test.mjs \
              filter-related-knowledge.test.mjs \
              test-conventions.test.mjs \
              register-ai-prompt.test.sh \
              save-ai-prompt.test.sh; do
              grep -q "PASS $suite" "$TMPDIR/failure-case.log"
            done
            touch "$out"
          '';
        in
        {
          inherit pkgs runAllTests testCheck testTools;
        };
    in
    {
      apps = forAllSystems (system:
        let
          env = perSystem system;
        in
        {
          test = {
            type = "app";
            program = "${env.runAllTests}/bin/run-all-tests";
          };
        });

      checks = forAllSystems (system:
        let
          env = perSystem system;
        in
        {
          test = env.testCheck;
        });

      devShells = forAllSystems (system:
        let
          env = perSystem system;
        in
        {
          default = env.pkgs.mkShell {
            packages = env.testTools ++ [ env.runAllTests ];
          };
        });
    };
}
