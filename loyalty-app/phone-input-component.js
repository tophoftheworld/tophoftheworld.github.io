// Shared Phone Input Component
// Reusable phone number input with individual digit boxes

class PhoneInputComponent {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            onComplete: options.onComplete || (() => {}),
            onChange: options.onChange || (() => {}),
            placeholder: options.placeholder || 'Enter customer phone number',
            showPrefix: options.showPrefix !== false, // default true
            ...options
        };
        this.phoneDigits = [];
        this.init();
    }

    init() {
        this.render();
        this.setupEventListeners();
    }

    render() {
        this.container.innerHTML = `
            <div class="text-center">
                <div class="text-base text-gray-600 mb-3">${this.options.placeholder}</div>
                <div class="flex items-center justify-center">
                    ${this.options.showPrefix ? `
                        <!-- +63 prefix -->
                        <div class="flex items-center">
                            <div class="w-6 h-10 bg-gray-100 border border-gray-300 rounded flex items-center justify-center text-gray-500 font-bold text-xs">+</div>
                            <div class="w-6 h-10 bg-gray-100 border border-gray-300 rounded flex items-center justify-center text-gray-500 font-bold text-xs">6</div>
                            <div class="w-6 h-10 bg-gray-100 border border-gray-300 rounded flex items-center justify-center text-gray-500 font-bold text-xs">3</div>
                        </div>
                        <!-- Space -->
                        <div class="w-1"></div>
                    ` : ''}
                    <!-- Phone number digits -->
                    <div class="flex items-center">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="0" inputmode="numeric" pattern="[0-9]*">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="1" inputmode="numeric" pattern="[0-9]*">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="2" inputmode="numeric" pattern="[0-9]*">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="3" inputmode="numeric" pattern="[0-9]*">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="4" inputmode="numeric" pattern="[0-9]*">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="5" inputmode="numeric" pattern="[0-9]*">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="6" inputmode="numeric" pattern="[0-9]*">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="7" inputmode="numeric" pattern="[0-9]*">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="8" inputmode="numeric" pattern="[0-9]*">
                        <input type="tel" class="phone-digit w-6 h-10 border border-gray-300 rounded text-center text-sm font-bold focus:border-green-500 focus:outline-none" maxlength="1" data-index="9" inputmode="numeric" pattern="[0-9]*">
                    </div>
                </div>
            </div>
        `;

        this.phoneDigits = this.container.querySelectorAll('.phone-digit');
    }

    setupEventListeners() {
        this.phoneDigits.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                const value = e.target.value;
                if (!/^\d$/.test(value)) { 
                    e.target.value = ''; 
                    return; 
                }
                
                if (value && index < this.phoneDigits.length - 1) { 
                    this.phoneDigits[index + 1].focus(); 
                }
                
                this.options.onChange(this.getValue());
                
                if (this.isComplete()) {
                    this.options.onComplete(this.getValue());
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !e.target.value && index > 0) { 
                    this.phoneDigits[index - 1].focus(); 
                }
                if (e.key === 'ArrowLeft' && index > 0) { 
                    this.phoneDigits[index - 1].focus(); 
                }
                if (e.key === 'ArrowRight' && index < this.phoneDigits.length - 1) { 
                    this.phoneDigits[index + 1].focus(); 
                }
                if (e.key === 'Enter' && this.isComplete()) { 
                    this.options.onComplete(this.getValue());
                }
            });

            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const pastedData = e.clipboardData.getData('text').replace(/\D/g, '');
                if (pastedData.length >= 10) {
                    for (let i = 0; i < Math.min(pastedData.length, this.phoneDigits.length); i++) { 
                        this.phoneDigits[i].value = pastedData[i]; 
                    }
                    this.options.onChange(this.getValue());
                    if (this.isComplete()) {
                        this.options.onComplete(this.getValue());
                    }
                }
            });
        });
    }

    getValue() {
        const digits = Array.from(this.phoneDigits).map(input => input.value).join('');
        if (this.options.showPrefix) {
            // Format as +63 XXX XXX XXXX to match Firebase storage
            return `+63 ${digits.substring(0, 3)} ${digits.substring(3, 6)} ${digits.substring(6)}`;
        }
        return digits;
    }

    setValue(phoneNumber) {
        // Normalize phone number - remove all non-digits
        const normalized = phoneNumber.replace(/\D/g, '');
        if (normalized.length >= 10) {
            const digits = normalized.slice(-10); // Get last 10 digits
            for (let i = 0; i < Math.min(digits.length, this.phoneDigits.length); i++) {
                this.phoneDigits[i].value = digits[i];
            }
        }
    }

    isComplete() {
        return Array.from(this.phoneDigits).every(input => input.value);
    }

    clear() {
        this.phoneDigits.forEach(input => input.value = '');
        this.phoneDigits[0].focus();
    }

    focus() {
        this.phoneDigits[0].focus();
    }
}

// Phone number normalization utility
function normalizePhoneNumber(phone) {
    if (!phone) return '';
    
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // Handle different formats
    if (digits.startsWith('63') && digits.length === 12) {
        // +639496471857 format
        return `+63${digits.slice(2)}`;
    } else if (digits.startsWith('0') && digits.length === 11) {
        // 09496471857 format
        return `+63${digits.slice(1)}`;
    } else if (digits.length === 10) {
        // 9496471857 format
        return `+63${digits}`;
    }
    
    return phone; // Return original if can't normalize
}
