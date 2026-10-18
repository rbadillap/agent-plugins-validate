# Run `make` to list the targets. Compatible with GNU Make 3.81, the version macOS ships in /usr/bin/make.
#
# `make` is the only interface: people, agents and CI run the same targets. It runs only binaries from
# node_modules/.bin, never npx, which could download an unpinned version.

BIN   := node_modules/.bin
ENTRY ?= src/main.ts
OUT   ?= dist/index.js
SRC   := $(shell find src -name '*.ts' ! -name '*.test.ts')

.DEFAULT_GOAL := help
.PHONY: help install lint format test build check-dist

help:
	@awk 'BEGIN { FS = ":.*## " } \
		/^## / { printf "\n%s\n", substr($$0, 4); next } \
		/^[a-z-]+:.*## / { printf "  %-12s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo

## Setup

install: node_modules/.package-lock.json ## Install the dependencies from package-lock.json, skipping install scripts
	@:

node_modules/.package-lock.json: package-lock.json
	@npm ci --ignore-scripts --no-fund --no-audit --loglevel=error

## Development

lint: install ## Check the code with Biome and the type checker
	@$(BIN)/biome check .
	@$(BIN)/tsc --noEmit

format: install ## Format the code and apply Biome's safe fixes
	@$(BIN)/biome check --write .

test: install ## Run the tests
	@node --test 'src/**/*.test.ts'

## Release

# --main-fields keeps esbuild from picking the UMD build of a package such as jsonc-parser, which can't
# be bundled. ENTRY and OUT can be overridden, which the bundle test does.
build: $(OUT) ## Bundle src/main.ts into dist/index.js
	@:

$(OUT): $(ENTRY) $(SRC) package-lock.json | install
	@$(BIN)/esbuild $(ENTRY) --bundle --platform=node --target=node24 --format=esm --main-fields=module,main --outfile=$(OUT) --log-level=warning

check-dist: build ## Fail if dist/ differs from what is committed
	@test -z "$$(git status --porcelain --untracked-files=all -- dist)" || { \
		echo "dist/ is out of date: run make build and commit the result" >&2; exit 1; }
