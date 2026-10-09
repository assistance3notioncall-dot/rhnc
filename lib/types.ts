export type Access = { module_key: string; label: string; sort: number; can_view: boolean; can_edit: boolean };

export type Profile = {
  id: string; company_id: string; role: "salarie" | "manager" | "rh" | "admin"; role_key: string | null;
  username: string | null; matricule: string | null; first_name: string; last_name: string; email: string | null;
  phone: string | null; cin: string | null; birth_date: string | null; family_status: string | null;
  children_count: number; address: string | null; emergency_contact: string | null; job_title: string | null;
  department_id: string | null; site_id: string | null; manager_id: string | null; hire_date: string | null;
  contract_type: string; contract_end: string | null; trial_end: string | null; status: string;
  account_status: "sans_compte" | "actif" | "bloque";
};

export type RequestRow = {
  id: string; ref: string | null; profile_id: string; kind: string; leave_type_id: string | null;
  template_id: string | null; start_date: string | null; end_date: string | null; days: number | null;
  amount: number | null; category: string | null; comment: string | null; status: string;
  rejection_reason: string | null; created_at: string; submitted_at: string | null;
};
