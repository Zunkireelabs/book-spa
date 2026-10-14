import React from 'react';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

const PRONOUN_OPTIONS = [
  { value: 'He/Him', label: 'He/Him' },
  { value: 'She/Her', label: 'She/Her' },
  { value: 'They/Them', label: 'They/Them' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

const StaffDetailsFields = ({ formData, setFormData }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Name</label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g. Anjali Thapa"
          autoFocus
        />
      </div>

      <Select
        label="Gender"
        options={GENDER_OPTIONS}
        value={formData.gender}
        onChange={(val) => setFormData({ ...formData, gender: val })}
      />

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Phone Number</label>
        <Input
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          placeholder="e.g. 98XXXXXXXX"
        />
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Email</label>
        <Input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          placeholder="e.g. anjali@example.com"
        />
      </div>

      <Select
        label="Pronouns"
        options={PRONOUN_OPTIONS}
        value={formData.pronouns}
        onChange={(val) => setFormData({ ...formData, pronouns: val })}
        placeholder="Select pronouns"
      />

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">City</label>
        <Input
          value={formData.city}
          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
        />
      </div>

      <div className="space-y-1 sm:col-span-2">
        <label className="block font-body font-body-medium text-sm text-text-primary">Address</label>
        <Input
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
        />
      </div>
    </div>
  );
};

export default StaffDetailsFields;
