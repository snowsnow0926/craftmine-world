extends Node2D

# Runs during import, @tool and export; the sandbox must survive code that the
# editor executes before the final game starts.
func _ready() -> void:
	print("sandbox-fixture-ready")
