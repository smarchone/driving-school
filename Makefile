PORT ?= 8000
HOST ?= 127.0.0.1
URL  := http://$(HOST):$(PORT)/

.PHONY: serve open

serve:
	@echo "Serving on $(URL)"
	python3 -m http.server $(PORT) --bind $(HOST)

open:
	open $(URL)
