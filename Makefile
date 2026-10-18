BIN := node_modules/.bin
ENTRY ?= src/main.ts
OUT ?= dist/index.js

.PHONY: install lint format test build check-dist

# Fail fast when dependencies are missing, instead of letting a tool fail obscurely.
need = @test -x $(BIN)/$(1) || { echo "$(1) not found: run make install first" >&2; exit 1; }

install:
	npm ci --ignore-scripts

lint:
	$(call need,biome)
	$(call need,tsc)
	$(BIN)/biome check .
	$(BIN)/tsc --noEmit

format:
	$(call need,biome)
	$(BIN)/biome check --write .

test:
	@test -d node_modules || { echo "dependencies not installed: run make install first" >&2; exit 1; }
	node --test 'src/**/*.test.ts'

build:
	$(call need,esbuild)
	# --main-fields keeps esbuild from picking the UMD build of packages such as jsonc-parser, which can't be bundled.
	$(BIN)/esbuild $(ENTRY) --bundle --platform=node --target=node24 --format=esm --main-fields=module,main --outfile=$(OUT)

check-dist: build
	@test -z "$$(git status --porcelain --untracked-files=all -- dist)" || { echo "dist/ is out of date: run make build and commit the result" >&2; exit 1; }
