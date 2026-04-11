from unittest.mock import MagicMock
from scraper.stages.filter import run_filter

def test_run_filter_calls_update_on_leads_table():
    mock_db = MagicMock()
    mock_db.client.table.return_value.update.return_value.eq.return_value.not_.is_.return_value.execute.return_value.data = [{"id": "a"}]
    mock_db.client.table.return_value.update.return_value.eq.return_value.is_.return_value.execute.return_value.data = []
    result = run_filter(db=mock_db)
    assert "qualified" in result
    assert "rejected" in result
    # confirm the leads table was touched
    calls = mock_db.client.table.call_args_list
    assert any(call.args[0] == "leads" for call in calls)
