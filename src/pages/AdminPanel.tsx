import { useState, useEffect } from 'react';
import { useTanks, useConfig, User, SystemConfig, Tank, isTankPlanned } from '@/store/useStore';
import { UserPlus, Trash2, Power, WifiOff, Settings, Loader2, Plus, Edit } from 'lucide-react';
import { firestore } from '@/config/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { registerOperator, updateUserProfile, deleteUserProfile } from '@/services/authService';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

/**
 * Custom React hook local to the Admin Panel for listening to the users collection in Firestore.
 */
function useFirestoreUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(firestore, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setUsers(list);
      setLoading(false);
    }, (error) => {
      console.error("Error listening to Firestore users:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addUser = async (user: { email: string; name: string; password: string; role: 'admin' | 'worker' | 'viewer'; jobTitle: string }) => {
    return await registerOperator(user.email, user.password, user.name, user.role, user.jobTitle);
  };

  const updateUser = async (id: string, updates: any) => {
    await updateUserProfile(id, updates);
  };

  const deleteUser = async (id: string) => {
    await deleteUserProfile(id);
  };

  return { users, loading, addUser, updateUser, deleteUser };
}

const AdminPanel = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'tanks' | 'config'>('users');
  const { users, loading, addUser, updateUser, deleteUser } = useFirestoreUsers();

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-primary">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">System administration and configuration</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <WifiOff size={14} /> Cloud Secured (Firestore)
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto scrollbar-none whitespace-nowrap">
        {[
          { key: 'users' as const, label: 'User Management', icon: <UserPlus size={14} /> },
          { key: 'tanks' as const, label: 'Tank Assignment', icon: <Power size={14} /> },
          { key: 'config' as const, label: 'Configuration', icon: <Settings size={14} /> },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors shrink-0 ${activeTab === tab.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && <UserManagement users={users} loading={loading} addUser={addUser} updateUser={updateUser} deleteUser={deleteUser} />}
      {activeTab === 'tanks' && <TankAssignment users={users} />}
      {activeTab === 'config' && <Configuration />}
    </div>
  );
};

interface UserManagementProps {
  users: any[];
  loading: boolean;
  addUser: (user: any) => Promise<any>;
  updateUser: (id: string, updates: any) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
}

const UserManagement = ({ users, loading, addUser, updateUser, deleteUser }: UserManagementProps) => {
  const { currentUser } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ 
    username: '', 
    email: '', 
    password: '', 
    jobTitle: 'Operator', 
    role: 'worker' as 'admin' | 'worker' | 'viewer' 
  });
  const [isAdding, setIsAdding] = useState(false);
  const [confirmUser, setConfirmUser] = useState<typeof newUser | null>(null);
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<any | null>(null);

  const handleAdd = () => {
    if (!newUser.username || !newUser.email || !newUser.password) {
      setFormError('Please fill in all fields');
      return;
    }
    
    let resolvedEmail = newUser.email.trim();
    if (resolvedEmail && !resolvedEmail.includes('@')) {
      resolvedEmail = `${resolvedEmail}@gmail.com`;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(resolvedEmail)) {
      setFormError('Please enter a valid email or username');
      return;
    }

    if (newUser.password.length < 6) {
      setFormError('Password must be at least 6 characters');
      return;
    }

    if (users.some(u => u.email.toLowerCase() === resolvedEmail.toLowerCase())) {
      setFormError('A user with this email or username already exists');
      return;
    }
    
    setFormError('');
    setConfirmUser({
      ...newUser,
      email: resolvedEmail
    });
  };

  const confirmAddUser = async () => {
    if (!confirmUser) return;
    setIsAdding(true);
    try {
      await addUser({ 
        email: confirmUser.email,
        password: confirmUser.password,
        name: confirmUser.username, 
        role: confirmUser.role, 
        jobTitle: confirmUser.role === 'admin' 
          ? 'Administrator' 
          : confirmUser.role === 'viewer' 
            ? 'Viewer' 
            : confirmUser.jobTitle 
      });
      toast.success(`Operator ${confirmUser.username} successfully registered!`);
      setNewUser({ username: '', email: '', password: '', jobTitle: 'Operator', role: 'worker' });
      setConfirmUser(null);
      setShowAdd(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to register operator');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeactivateToggle = async (userId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
      await updateUser(userId, { status: newStatus });
      toast.success(`User status successfully updated to ${newStatus}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to change user status');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await deleteUser(userId);
      toast.success('User account successfully removed');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete user profile');
    }
  };

  const activeUsers = users.filter(u => u.status === 'active').length;
  const inactiveUsers = users.filter(u => u.status === 'inactive').length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Registered Users</h3>
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            <UserPlus size={16} /> Add New User
          </button>
        </div>

        {showAdd && (
          <div className="mb-4 p-4 bg-secondary/50 rounded-lg space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <input placeholder="Operator Name" value={newUser.username}
                onChange={e => { setNewUser({ ...newUser, username: e.target.value }); setFormError(''); }}
                className={`rounded-lg border px-3 py-2 text-sm bg-background ${formError ? 'border-danger' : 'border-input'}`} />
              <input placeholder="Email or Username" type="text" value={newUser.email}
                onChange={e => { setNewUser({ ...newUser, email: e.target.value }); setFormError(''); }}
                className={`rounded-lg border px-3 py-2 text-sm bg-background ${formError ? 'border-danger' : 'border-input'}`} />
              <input placeholder="Secure Password" type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                className="rounded-lg border border-input px-3 py-2 text-sm bg-background" />
              <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value as 'admin' | 'worker' | 'viewer' })}
                className="rounded-lg border border-input px-3 py-2 text-sm bg-background">
                <option value="worker">Worker (Operator)</option>
                <option value="viewer">Viewer (Read-Only)</option>
                <option value="admin">Administrator</option>
              </select>
              {newUser.role === 'worker' ? (
                <select value={newUser.jobTitle} onChange={e => setNewUser({ ...newUser, jobTitle: e.target.value })}
                  className="rounded-lg border border-input px-3 py-2 text-sm bg-background">
                  <option>Operator</option><option>Supervisor</option><option>Technician</option>
                </select>
              ) : (
                <div className="rounded-lg border border-input px-3 py-2 text-sm bg-background/50 text-muted-foreground flex items-center justify-center">
                  - N/A -
                </div>
              )}
              <button onClick={handleAdd} className="rounded-lg bg-safe px-4 py-2 text-sm font-semibold text-safe-foreground">Register</button>
            </div>
            {formError && <p className="text-xs text-danger font-medium">⚠️ {formError}</p>}
          </div>
        )}

        {confirmUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50">
            <div className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 space-y-4">
              <h4 className="text-lg font-semibold">Confirm New User</h4>
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Operator Name:</span> <span className="font-semibold">{confirmUser.username}</span></p>
                <p><span className="text-muted-foreground">Email:</span> <span className="font-semibold">{confirmUser.email}</span></p>
                <p><span className="text-muted-foreground">Role:</span> <span className="font-semibold">
                  {confirmUser.role === 'admin' 
                    ? 'Administrator' 
                    : confirmUser.role === 'viewer' 
                      ? 'Viewer' 
                      : confirmUser.jobTitle}
                </span></p>
              </div>
              <p className="text-xs text-muted-foreground">Are you sure you want to register this user into the secure system?</p>
              <div className="flex gap-3">
                <button disabled={isAdding} onClick={() => setConfirmUser(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary transition disabled:opacity-50">Cancel</button>
                <button disabled={isAdding} onClick={confirmAddUser} className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5 disabled:opacity-50">
                  {isAdding ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Confirm'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-sm font-medium">Synchronizing system operator profiles...</p>
            </div>
          ) : (
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-bold text-base">Operator Name</th>
                  <th className="pb-3 font-bold text-base">Email Address</th>
                  <th className="pb-3 font-bold text-base">System Role</th>
                  <th className="pb-3 font-bold text-base">Status</th>
                  <th className="pb-3 font-bold text-base text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className="border-b border-border">
                    <td className="py-3 font-bold text-base">{user.username}</td>
                    <td className="py-3 text-base text-muted-foreground font-mono">{user.email}</td>
                    <td className="py-3 font-semibold text-base">
                      <span className={`px-2 py-0.5 rounded text-xs font-extrabold uppercase border ${
                        user.role === 'admin' 
                          ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' 
                          : user.role === 'viewer' 
                            ? 'bg-sky-500/10 text-sky-600 border-sky-500/20' 
                            : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      }`}>
                        {user.role === 'admin' ? 'Admin' : user.role === 'viewer' ? 'Viewer' : user.jobTitle}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded-full text-sm font-bold ${user.status === 'active' ? 'bg-safe/10 text-safe' : 'bg-muted text-muted-foreground'
                        }`}>{user.status === 'active' ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(currentUser?.role === 'admin' && user.role !== 'admin' && user.id !== currentUser?.id) ? (
                          <button onClick={() => handleDeactivateToggle(user.id, user.status)}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-bold ${user.status === 'active' ? 'border-danger/30 text-danger' : 'border-safe/30 text-safe'
                              }`}>
                            {user.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic px-2 py-1 bg-secondary/30 rounded border border-border/40">No Permission</span>
                        )}

                        {(currentUser?.role === 'admin' && user.role !== 'admin' && user.id !== currentUser?.id) && (
                          <button onClick={() => setDeleteConfirm(user)} className="rounded-lg border border-danger/30 p-1.5 text-danger">
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50">
            <div className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 space-y-4">
              <h4 className="text-lg font-semibold">Delete User</h4>
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Operator Name:</span> <span className="font-bold">{deleteConfirm.username}</span></p>
                <p><span className="text-muted-foreground">Email:</span> <span className="font-bold">{deleteConfirm.email}</span></p>
                <p><span className="text-muted-foreground">Role:</span> <span className="font-bold">{deleteConfirm.role === 'admin' ? 'Administrator' : deleteConfirm.jobTitle}</span></p>
              </div>
              <p className="text-sm text-danger font-medium">⚠️ This action cannot be undone. Are you sure you want to delete this user profile?</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary transition">Cancel</button>
                <button onClick={() => { handleDeleteUser(deleteConfirm.id); setDeleteConfirm(null); }} className="flex-1 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground hover:opacity-90 transition">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">User Statistics</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Total Users</p>
            <p className="text-2xl font-bold">{users.length}</p>
          </div>
          <div className="rounded-lg border border-safe/30 p-4">
            <p className="text-xs text-safe">Active Users</p>
            <p className="text-2xl font-bold">{activeUsers}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Inactive Users</p>
            <p className="text-2xl font-bold">{inactiveUsers}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

interface TankAssignmentProps {
  users: any[];
}

const TankAssignment = ({ users }: TankAssignmentProps) => {
  const { tanks, updateTank, addTank, deleteTank } = useTanks();
  // Include only active worker accounts in the operators listing
  const workers = users.filter(u => u.role === 'worker' && u.status === 'active');

  // Modal and Form States for CRUD
  const [showAddTank, setShowAddTank] = useState(false);
  const [newTankData, setNewTankData] = useState({ id: '', name: '', location: '' });
  const [isAddingTank, setIsAddingTank] = useState(false);
  const [addTankError, setAddTankError] = useState('');

  const [editingTank, setEditingTank] = useState<any | null>(null);
  const [editTankData, setEditTankData] = useState({ name: '', location: '' });
  const [isEditingTank, setIsEditingTank] = useState(false);

  const [deletingTank, setDeletingTank] = useState<any | null>(null);
  const [isDeletingTank, setIsDeletingTank] = useState(false);

  const handleWorkerChange = async (tankId: string, workerId: string | null) => {
    try {
      await updateTank(tankId, { assignedWorker: workerId });
      toast.success(workerId ? 'Operator assigned successfully!' : 'Tank unassigned successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign operator');
    }
  };

  const handleToggleEnabled = async (tankId: string, currentEnabled: boolean) => {
    try {
      await updateTank(tankId, {
        enabled: !currentEnabled,
        ...(currentEnabled ? { pumpOn: false, assignedWorker: null } : {})
      });
      toast.success(`Tank successfully ${!currentEnabled ? 'enabled' : 'disabled'}!`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update tank availability');
    }
  };

  const handleAddTankSubmit = async () => {
    if (!newTankData.id || !newTankData.name) {
      setAddTankError('Please fill in both Tank ID and Name.');
      return;
    }

    if (tanks.some(t => t.id === newTankData.id)) {
      setAddTankError(`A tank with ID "${newTankData.id}" already exists.`);
      return;
    }

    setIsAddingTank(true);
    try {
      await addTank({
        id: newTankData.id,
        name: newTankData.name,
        location: newTankData.location || 'Unspecified',
        assignedWorker: null,
      });
      toast.success(`Tank "${newTankData.name}" successfully registered!`);
      setShowAddTank(false);
      setNewTankData({ id: '', name: '', location: '' });
    } catch (err: any) {
      setAddTankError(err.message || 'Failed to register tank');
      toast.error(err.message || 'Failed to register tank');
    } finally {
      setIsAddingTank(false);
    }
  };

  const handleEditTankSubmit = async () => {
    if (!editingTank) return;
    if (!editTankData.name) {
      toast.error('Tank Name cannot be empty.');
      return;
    }

    setIsEditingTank(true);
    try {
      await updateTank(editingTank.id, {
        name: editTankData.name,
        location: editTankData.location || 'Unspecified'
      });
      toast.success('Tank details successfully updated!');
      setEditingTank(null);
      setEditTankData({ name: '', location: '' });
    } catch (err: any) {
      toast.error(err.message || 'Failed to update tank details');
    } finally {
      setIsEditingTank(false);
    }
  };

  const handleDeleteTankSubmit = async () => {
    if (!deletingTank) return;
    setIsDeletingTank(true);
    try {
      await deleteTank(deletingTank.id);
      toast.success(`Tank "${deletingTank.name}" permanently deleted.`);
      setDeletingTank(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete tank');
    } finally {
      setIsDeletingTank(false);
    }
  };

  return (
    <div className="rounded-xl bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Power size={18} /> Tank Assignment & Management
        </h3>
        <button onClick={() => setShowAddTank(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
          <Plus size={14} /> Register New Tank
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-3 font-medium">Tank</th>
              <th className="pb-3 font-medium">Location</th>
              <th className="pb-3 font-medium">Current Status</th>
              <th className="pb-3 font-medium">Assigned Operator</th>
              <th className="pb-3 font-medium">Availability</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tanks.map(tank => (
              <tr key={tank.id} className={`border-b border-border ${!tank.enabled ? 'opacity-50' : ''}`}>
                <td className="py-4 font-semibold text-foreground">{tank.name} (ID: {tank.id})</td>
                <td className="py-4 text-muted-foreground font-medium">{tank.location || 'Unspecified'}</td>
                <td className="py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    !tank.enabled ? 'bg-muted text-muted-foreground' :
                    isTankPlanned(tank) ? 'bg-muted text-muted-foreground border border-border' :
                    tank.status === 'warning' ? 'bg-warning/10 text-warning' :
                    tank.status === 'danger' ? 'bg-danger/10 text-danger' :
                    'bg-safe/10 text-safe'
                  }`}>
                    {!tank.enabled ? 'Disabled' : isTankPlanned(tank) ? 'Planned' : tank.status === 'safe' ? 'Safe' : tank.status === 'warning' ? 'Warning' : 'Danger'}
                  </span>
                </td>
                <td className="py-4">
                  <select
                    disabled={!tank.enabled}
                    value={tank.assignedWorker || ''}
                    onChange={e => handleWorkerChange(tank.id, e.target.value || null)}
                    className="rounded-lg border border-input bg-secondary/50 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 text-foreground"
                  >
                    <option value="">Unassigned</option>
                    {workers.map(w => (
                      <option key={w.id} value={w.id}>{w.username} ({w.role === 'admin' ? 'Admin' : w.jobTitle})</option>
                    ))}
                  </select>
                </td>
                <td className="py-4">
                  <span className={`text-sm font-medium ${tank.enabled ? 'text-safe' : 'text-danger'}`}>
                    {tank.enabled ? 'Available' : 'Unavailable'}
                  </span>
                </td>
                <td className="py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleToggleEnabled(tank.id, tank.enabled)}
                      className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${tank.enabled ? 'border-danger/30 text-danger animate-pulse hover:bg-danger/5' : 'border-safe/30 text-safe hover:bg-safe/5'
                        }`}
                    >
                      <Power size={12} /> {tank.enabled ? 'Disable' : 'Enable'}
                    </button>
                    
                    <button
                      onClick={() => { setEditingTank(tank); setEditTankData({ name: tank.name, location: tank.location || '' }); }}
                      className="rounded-lg border border-primary/30 p-1.5 text-primary hover:bg-primary/5"
                      title="Edit Name & Location"
                    >
                      <Edit size={14} />
                    </button>

                    {/* Disable deletion for tank 1 (esp32 default target) */}
                    {tank.id !== '1' ? (
                      <button
                        onClick={() => setDeletingTank(tank)}
                        className="rounded-lg border border-danger/30 p-1.5 text-danger hover:bg-danger/5"
                        title="Delete Tank"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <div className="p-1.5 text-muted-foreground opacity-30 cursor-not-allowed border border-border rounded" title="Telemetry Primary (Locked)">
                        <Trash2 size={14} />
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Register New Tank Modal */}
      {showAddTank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border/40 rounded-xl p-6 shadow-xl max-w-md w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
            <h4 className="text-lg font-bold text-primary flex items-center gap-2">
              <Plus size={20} /> Register New Tank
            </h4>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank ID (Numeric, e.g. 5)</label>
                <input
                  type="text"
                  placeholder="e.g. 5"
                  value={newTankData.id}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, ''); // Numeric only
                    setNewTankData({ ...newTankData, id: val });
                    setAddTankError('');
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank Name</label>
                <input
                  type="text"
                  placeholder="e.g. Reservoir Tank 5"
                  value={newTankData.name}
                  onChange={e => {
                    setNewTankData({ ...newTankData, name: e.target.value });
                    setAddTankError('');
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank Location</label>
                <input
                  type="text"
                  placeholder="e.g. Sector C, Ground Floor"
                  value={newTankData.location}
                  onChange={e => setNewTankData({ ...newTankData, location: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
            </div>

            {addTankError && <p className="text-xs text-danger font-semibold">⚠️ {addTankError}</p>}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowAddTank(false); setNewTankData({ id: '', name: '', location: '' }); setAddTankError(''); }}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground"
              >
                Cancel
              </button>
              <button
                disabled={isAddingTank}
                onClick={handleAddTankSubmit}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5"
              >
                {isAddingTank ? <Loader2 size={16} className="animate-spin" /> : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tank Modal */}
      {editingTank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border/40 rounded-xl p-6 shadow-xl max-w-md w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
            <h4 className="text-lg font-bold text-primary flex items-center gap-2">
              <Edit size={18} /> Edit Tank Location & Name
            </h4>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank Name</label>
                <input
                  type="text"
                  placeholder="e.g. Reservoir Tank"
                  value={editTankData.name}
                  onChange={e => setEditTankData({ ...editTankData, name: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank Location</label>
                <input
                  type="text"
                  placeholder="e.g. Sector C, Ground Floor"
                  value={editTankData.location}
                  onChange={e => setEditTankData({ ...editTankData, location: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setEditingTank(null); setEditTankData({ name: '', location: '' }); }}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground"
              >
                Cancel
              </button>
              <button
                disabled={isEditingTank}
                onClick={handleEditTankSubmit}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5"
              >
                {isEditingTank ? <Loader2 size={16} className="animate-spin" /> : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Tank Modal */}
      {deletingTank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border/40 rounded-xl p-6 shadow-xl max-w-sm w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-danger mb-2">
              <Trash2 size={24} className="text-primary animate-pulse" />
              <h4 className="text-lg font-bold text-foreground">Confirm Delete Tank</h4>
            </div>
            
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{deletingTank.name}</strong> from the MSU Water Monitoring System?
            </p>
            <p className="text-xs text-danger font-medium">
              ⚠️ This will permanently remove its real-time telemetry node and all database records.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setDeletingTank(null)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground"
              >
                Cancel
              </button>
              <button
                disabled={isDeletingTank}
                onClick={handleDeleteTankSubmit}
                className="flex-1 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5"
              >
                {isDeletingTank ? <Loader2 size={16} className="animate-spin" /> : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Configuration = () => {
  const { config, updateConfig } = useConfig();
  const { tanks, updateTank } = useTanks();
  
  // Local state to prevent database spamming on keystrokes
  const [localConfig, setLocalConfig] = useState<SystemConfig | null>(null);
  const [localTank1, setLocalTank1] = useState<Partial<Tank> | null>(null);
  
  const [controlConfirm, setControlConfirm] = useState<{ key: 'maintenanceMode' | 'pumpControlLock'; label: string; newState: boolean } | null>(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const tank1 = tanks.find(t => t.id === '1');

  // Initialize and synchronize local states when database loads
  useEffect(() => {
    if (config) {
      setLocalConfig(config);
    }
  }, [config]);

  useEffect(() => {
    if (tank1) {
      setLocalTank1(tank1);
    }
  }, [tank1]);

  const handleToggle = (key: 'maintenanceMode' | 'pumpControlLock', label: string) => {
    if (!localConfig) return;
    setControlConfirm({ key, label, newState: !localConfig[key] });
  };

  const confirmToggle = async () => {
    if (!controlConfirm || !localConfig) return;
    try {
      await updateConfig({ [controlConfirm.key]: controlConfirm.newState });
      toast.success(`${controlConfirm.label} successfully ${controlConfirm.newState ? 'enabled' : 'disabled'}!`);
      setControlConfirm(null);
    } catch (err: any) {
      toast.error(err.message || `Failed to update ${controlConfirm.label}`);
    }
  };


  const handleSaveAll = async () => {
    if (!localConfig) return;
    setIsSaving(true);
    try {
      // Clean and parse all inputs to valid numbers before committing to Firebase
      const parsedConfig = {
        ...localConfig,
        lowLevelThreshold: Number(localConfig.lowLevelThreshold),
        overflowThreshold: Number(localConfig.overflowThreshold),
        minPh: Number(localConfig.minPh),
        maxPh: Number(localConfig.maxPh),
      };

      await updateConfig(parsedConfig);

      if (localTank1) {
        const parsedTank1 = {
          ...localTank1,
          levelVmin: Number(localTank1.levelVmin),
          levelVmax: Number(localTank1.levelVmax),
          tankHeight: Number(localTank1.tankHeight),
          levelOffset: Number(localTank1.levelOffset),
          phNeutralVoltage: Number(localTank1.phNeutralVoltage),
          phSlope: Number(localTank1.phSlope),
          phOffset: Number(localTank1.phOffset),
        };
        await updateTank('1', parsedTank1);
      }
      
      toast.success('System configuration and sensor calibrations saved successfully!');
      setShowSaveConfirm(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  if (!localConfig) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2 bg-card rounded-xl shadow-sm">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <p className="text-sm font-medium">Loading system configurations...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Reservoir Settings</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Low-Level Threshold (%)</label>
            <input 
              type="number" 
              value={localConfig.lowLevelThreshold} 
              onChange={e => setLocalConfig({ ...localConfig, lowLevelThreshold: e.target.value as any })}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
            <p className="text-xs text-muted-foreground mt-1">Alert when water level falls below this percentage</p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Overflow-Level Threshold (%)</label>
            <input 
              type="number" 
              value={localConfig.overflowThreshold} 
              onChange={e => setLocalConfig({ ...localConfig, overflowThreshold: e.target.value as any })}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
            <p className="text-xs text-muted-foreground mt-1">Alert when water level exceeds this percentage</p>
          </div>
        </div>

        <h4 className="font-semibold mt-6 mb-3">pH Safe Range</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Minimum pH</label>
            <input 
              type="number" 
              step="0.1" 
              value={localConfig.minPh} 
              onChange={e => setLocalConfig({ ...localConfig, minPh: e.target.value as any })}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Maximum pH</label>
            <input 
              type="number" 
              step="0.1" 
              value={localConfig.maxPh} 
              onChange={e => setLocalConfig({ ...localConfig, maxPh: e.target.value as any })}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Safe pH range: {localConfig.minPh} - {localConfig.maxPh}</p>
      </div>

      <div className="rounded-xl bg-card p-6 shadow-sm border border-border">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Settings size={18} className="text-primary" /> Sensor Calibration & Offsets (Tank 1)
        </h3>
        
        {localTank1 ? (
          <div className="space-y-6">
            <div>
              <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Water Level Sensor Calibration</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Vmin (Empty Tank Voltage)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={localTank1.levelVmin ?? ''}
                    onChange={e => setLocalTank1({ ...localTank1, levelVmin: e.target.value as any })}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Voltage when tank is 0% full</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Vmax (Full Tank Voltage)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={localTank1.levelVmax ?? ''}
                    onChange={e => setLocalTank1({ ...localTank1, levelVmax: e.target.value as any })}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Voltage when tank is 100% full</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Physical Tank Height (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={localTank1.tankHeight ?? ''}
                    onChange={e => setLocalTank1({ ...localTank1, tankHeight: e.target.value as any })}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Height of reservoir in meters</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Reading Offset (%)</label>
                  <input
                    type="number"
                    step="1"
                    value={localTank1.levelOffset ?? ''}
                    onChange={e => setLocalTank1({ ...localTank1, levelOffset: e.target.value as any })}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Adjustment offset (+/- %)</p>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">pH Sensor Calibration</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Neutral Reference Voltage (V)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={localTank1.phNeutralVoltage ?? ''}
                    onChange={e => setLocalTank1({ ...localTank1, phNeutralVoltage: e.target.value as any })}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Voltage at pH 7.00 (typically 2.5V)</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Slope Sensitivity (V/pH)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={localTank1.phSlope ?? ''}
                    onChange={e => setLocalTank1({ ...localTank1, phSlope: e.target.value as any })}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Voltage step per pH unit (default 0.18)</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Reading Offset (pH)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={localTank1.phOffset ?? ''}
                    onChange={e => setLocalTank1({ ...localTank1, phOffset: e.target.value as any })}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Adjustment offset (+/- pH)</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Tank 1 calibration data is loading...</p>
        )}
      </div>

      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">System Controls</h3>
        <div className="space-y-4">
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border ${localConfig.maintenanceMode ? 'border-warning bg-warning/5' : 'border-border'}`}>
            <div className="flex items-center gap-3">
              <Settings size={18} className={localConfig.maintenanceMode ? 'text-warning' : 'text-muted-foreground'} />
              <div>
                <p className="font-medium text-sm">Maintenance Mode</p>
                <p className="text-xs text-muted-foreground">Disables all pump controls and suppresses alerts system-wide</p>
                {localConfig.maintenanceMode && <p className="text-xs text-warning font-medium mt-1">⚠️ Currently active — all pumps are locked</p>}
              </div>
            </div>
            <button onClick={() => handleToggle('maintenanceMode', 'Maintenance Mode')}
              className={`relative h-6 w-11 rounded-full transition-colors shrink-0 self-end sm:self-auto ${localConfig.maintenanceMode ? 'bg-warning' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${localConfig.maintenanceMode ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border ${localConfig.pumpControlLock ? 'border-danger bg-danger/5' : 'border-border'}`}>
            <div className="flex items-center gap-3">
              <Power size={18} className={localConfig.pumpControlLock ? 'text-danger' : 'text-muted-foreground'} />
              <div>
                <p className="font-medium text-sm">Pump Control Lock</p>
                <p className="text-xs text-muted-foreground">Locks all pump controls for workers — admins can still toggle pumps</p>
                {localConfig.pumpControlLock && <p className="text-xs text-danger font-medium mt-1">🔒 Active — workers cannot control pumps</p>}
              </div>
            </div>
            <button onClick={() => handleToggle('pumpControlLock', 'Pump Control Lock')}
              className={`relative h-6 w-11 rounded-full transition-colors shrink-0 self-end sm:self-auto ${localConfig.pumpControlLock ? 'bg-danger' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${localConfig.pumpControlLock ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <button disabled={isSaving} onClick={() => setShowSaveConfirm(true)} className="w-full rounded-lg bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-2">
        <Settings size={16} /> Save All Configurations
      </button>

      {/* Save All Configurations Confirmation Modal */}
      {showSaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border/40 rounded-xl p-6 shadow-xl max-w-md w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-primary mb-2">
              <Settings size={24} className="text-primary animate-spin-slow" />
              <h4 className="text-lg font-bold text-foreground">Confirm System Configurations</h4>
            </div>
            
            <div className="text-sm text-muted-foreground space-y-3">
              <p>
                Are you sure you want to write these new system settings and telemetry calibrations to the active database?
              </p>
              <div className="bg-secondary/40 p-3 rounded-lg text-xs space-y-1.5 border border-border/50 font-medium text-foreground/80">
                <p>📊 <strong>Water Level Thresholds:</strong> Low: {localConfig.lowLevelThreshold}% | Overflow: {localConfig.overflowThreshold}%</p>
                <p>🧪 <strong>pH Safety Range:</strong> Min: {localConfig.minPh} | Max: {localConfig.maxPh}</p>
                {localTank1 && (
                  <p>⚙️ <strong>Sensor Calibrations:</strong> Vmin: {localTank1.levelVmin}V | Vmax: {localTank1.levelVmax}V | Height: {localTank1.tankHeight}m</p>
                )}
              </div>
              <p className="text-xs text-danger font-medium">
                ⚠️ Malformed calibration coefficients or threshold parameters can disrupt automatic pump triggers and trigger false-alarm telemetry notifications.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                disabled={isSaving}
                onClick={() => setShowSaveConfirm(false)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={isSaving}
                onClick={handleSaveAll}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Applying...
                  </>
                ) : (
                  'Confirm & Apply'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {controlConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 border border-border/40 space-y-4 animate-in zoom-in-95 duration-200">
            <h4 className="text-lg font-semibold">{controlConfirm.newState ? 'Enable' : 'Disable'} {controlConfirm.label}</h4>
            <p className="text-sm text-muted-foreground">
              {controlConfirm.key === 'maintenanceMode' && controlConfirm.newState && 'This will disable all pump controls and suppress all alerts system-wide. No one will be able to toggle pumps.'}
              {controlConfirm.key === 'maintenanceMode' && !controlConfirm.newState && 'This will restore normal operations. Pump controls and alerts will be re-enabled.'}
              {controlConfirm.key === 'pumpControlLock' && controlConfirm.newState && 'This will lock all pump controls for workers. Only admins will be able to toggle pumps.'}
              {controlConfirm.key === 'pumpControlLock' && !controlConfirm.newState && 'This will unlock pump controls. Assigned workers will be able to toggle their tank pumps again.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setControlConfirm(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground">Cancel</button>
              <button onClick={confirmToggle} className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition ${controlConfirm.newState ? 'bg-danger' : 'bg-safe'}`}>
                {controlConfirm.newState ? 'Enable' : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
