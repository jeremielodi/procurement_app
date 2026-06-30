
const db = require('../config/database');

class WorkFlowModel {
    async getByProcessInstanceId(processInstanceId) {
        return db.select('SELECT * FROM workflow_history where process_instance_id=$1', [processInstanceId]);
    }
}

module.exports = new WorkFlowModel();