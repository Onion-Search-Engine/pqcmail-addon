/**
 * Entry point per il bundle crypto/pqc_lib.js
 * Espone i primitivi PQC come self.PQC per il Web Worker.
 *
 * Algoritmi:
 *   ML-KEM  (FIPS 203) — ex CRYSTALS-Kyber
 *   ML-DSA  (FIPS 204) — ex CRYSTALS-Dilithium
 *   SLH-DSA (FIPS 205) — ex SPHINCS+
 */
import { ml_kem512, ml_kem768, ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa44, ml_dsa65, ml_dsa87 }    from '@noble/post-quantum/ml-dsa.js';
import { slh_dsa_shake_256s, slh_dsa_sha2_256s } from '@noble/post-quantum/slh-dsa.js';

self.PQC = {
  // ML-KEM (Key Encapsulation Mechanism)
  ml_kem512,
  ml_kem768,
  ml_kem1024,
  // ML-DSA (Digital Signature Algorithm)
  ml_dsa44,
  ml_dsa65,
  ml_dsa87,
  // SLH-DSA (Stateless Hash-based DSA)
  slh_dsa_shake_256s,
  slh_dsa_sha2_256s,
};
