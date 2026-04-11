from typer.testing import CliRunner
from scraper.cli import app

runner = CliRunner()

def test_cli_shows_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "discover" in result.stdout
    assert "filter" in result.stdout
    assert "enrich" in result.stdout
    assert "score" in result.stdout
